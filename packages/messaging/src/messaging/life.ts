import type { BrokerConnection, BrokerConsumer, ConsumeRun, Delivery } from '../broker/index.ts';
import {
  leftPending,
  type Named,
  type Received,
  type Settle,
  type Settled,
  type TroubleReport,
} from '../consuming/index.ts';
import { CloseAbortedError, type CloseOptions, MessagingClosedError } from './closed.ts';
import { DeliveriesInFlight } from './handing-back.ts';

/** Whether a `consume` has handed the broker its consumers, or is handing them: taken until the broker rejects them. */
type Consumption = 'none' | 'taken';

/** How closing ended: with nothing left in flight, or with `close`'s signal aborted, and why. */
type Ended = { readonly kind: 'idle' } | { readonly kind: 'stopped'; readonly reason: unknown };

/** Where one messaging is in its life: open, closing while what is in flight settles, or closed. */
type State =
  | { readonly kind: 'open'; readonly consumption: Consumption }
  | {
      readonly kind: 'closing';
      readonly closed: Promise<void>;
      readonly ended: (ended: Ended) => void;
    }
  | { readonly kind: 'closed'; readonly closed: Promise<void> };

/** What the consumers of one `consume` are built with: `received`, and the signals of closing and of handing back. */
export type ConsumerLife = {
  readonly received: Received;
  readonly closing: AbortSignal;
  readonly handingBack: AbortSignal;
};

/**
 * The life of one messaging over its broker connection: publishing while open or closing, since a
 * Handler running may still publish; consuming once; and closed the moment nothing is in flight,
 * the Handlers running, a `publish`, a `send`, a `consume` or a trouble report, or once `close`'s
 * signal aborts, handing back what still runs. The core, not the adapter, keeps what is in flight.
 */
export class MessagingLife {
  readonly #connection: BrokerConnection;
  #state: State = { kind: 'open', consumption: 'none' };
  readonly #closing = new AbortController();
  readonly #inFlight = new Set<Promise<unknown>>();
  readonly #delivering = new DeliveriesInFlight();

  constructor(connection: BrokerConnection) {
    this.#connection = connection;
  }

  /** The broker connection to publish and send through, until messaging is closed. */
  connectionOf(): BrokerConnection {
    switch (this.#state.kind) {
      case 'open':
      case 'closing':
        return this.#connection;
      case 'closed':
        throw new MessagingClosedError('closed');
    }
  }

  /** A call in flight, a `publish`, a `send`, the adapter's `consume`, a Handler running or a trouble report, which `close` waits for. */
  tracked<Settled>(call: Promise<Settled>): Promise<Settled> {
    this.#inFlight.add(call);
    const forget = () => this.#forget(call);
    call.then(forget, forget);
    return call;
  }

  /**
   * Hands the broker its consumers, once, built with `received`, which runs a delivery only while
   * open, and where it reports their trouble; a broker that rejects them leaves `consume` to retry.
   */
  async consume(
    consumersOf: (life: ConsumerLife) => readonly BrokerConsumer[],
    report: TroubleReport,
  ): Promise<void> {
    const state = this.#state;
    switch (state.kind) {
      case 'closing':
      case 'closed':
        throw new MessagingClosedError(state.kind);
      case 'open':
        if (state.consumption === 'taken') {
          throw new Error('consume() was already called on this messaging');
        }
    }
    const consumers = consumersOf({
      received: (settle, named) => (delivery) => this.#received(settle, named, delivery),
      closing: this.#closing.signal,
      handingBack: this.#delivering.handingBack,
    });
    this.#consumption('taken');
    const run: ConsumeRun = {
      closing: this.#closing.signal,
      troubled: (trouble) => void this.tracked(report(trouble)),
    };
    try {
      await this.tracked(this.#connection.consume(consumers, run));
    } catch (e) {
      this.#consumption('none');
      throw e;
    }
  }

  /**
   * Stops consuming, waits for everything in flight and closes the broker connection; once a call's
   * `signal` aborts, it hands back the Messages whose Handlers still run instead. Called again, the same promise.
   */
  close({ signal }: CloseOptions = {}): Promise<void> {
    const state = this.#state;
    switch (state.kind) {
      case 'open': {
        this.#closing.abort(new MessagingClosedError('closing'));
        const ended = Promise.withResolvers<Ended>();
        const closed = ended.promise.then((end) => this.#closedAfter(end));
        this.#state = { kind: 'closing', closed, ended: ended.resolve };
        this.#endedIfIdle();
        this.#stoppedBy(signal, closed);
        return closed;
      }
      case 'closing':
        this.#stoppedBy(signal, state.closed);
        return state.closed;
      case 'closed':
        return state.closed;
    }
  }

  /** Where `consume` stands, kept only while open: closing ends consuming whatever the broker does. */
  #consumption(consumption: Consumption): void {
    switch (this.#state.kind) {
      case 'open':
        this.#state = { kind: 'open', consumption };
        return;
      case 'closing':
      case 'closed':
        return;
    }
  }

  /** A delivery while open runs its Handler; one while closing or closed is left pending, its Handler never run. */
  #received(settle: Settle, named: Named, delivery: Delivery): Promise<Settled> {
    switch (this.#state.kind) {
      case 'closing':
      case 'closed':
        return Promise.resolve(leftPending);
      case 'open': {
        const settling = settle(delivery);
        this.#delivering.add(settling, named, delivery);
        return this.tracked(settling);
      }
    }
  }

  /** Closing stops waiting once the signal aborts, or at once if it has; its listener goes once closed. */
  #stoppedBy(signal: AbortSignal | undefined, closed: Promise<void>): void {
    if (signal === undefined) {
      return;
    }
    const stop = () => this.#ended({ kind: 'stopped', reason: signal.reason });
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener('abort', stop, { once: true });
    const forget = () => signal.removeEventListener('abort', stop);
    closed.then(forget, forget);
  }

  /** Closes the broker connection once closing ended; stopped, after handing back what still runs, naming it. */
  async #closedAfter(end: Ended): Promise<void> {
    if (end.kind === 'idle') {
      await this.#connection.close();
      return;
    }
    const handedBack = await this.#delivering.handBack();
    await this.#connection.close();
    if (handedBack.length > 0) {
      throw new CloseAbortedError(handedBack, end.reason);
    }
  }

  #forget(call: Promise<unknown>): void {
    this.#inFlight.delete(call);
    this.#endedIfIdle();
  }

  /** Closing ends the moment nothing is in flight, so a call is either waited for or throws. */
  #endedIfIdle(): void {
    if (this.#inFlight.size === 0) {
      this.#ended({ kind: 'idle' });
    }
  }

  /** Closing ends once, idle or stopped, whichever comes first; messaging is closed from then on. */
  #ended(end: Ended): void {
    const state = this.#state;
    switch (state.kind) {
      case 'closing':
        this.#state = { kind: 'closed', closed: state.closed };
        state.ended(end);
        return;
      case 'open':
      case 'closed':
        return;
    }
  }
}
