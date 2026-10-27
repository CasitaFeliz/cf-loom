import type { BrokerConnection, ConsumeRun, Delivery } from '../broker/index.ts';
import {
  type CoreConsumer,
  type DeliveryEnds,
  leftPending,
  type Named,
  type Received,
  type Settle,
  type Settled,
  type TroubleTell,
  troubledOf,
  whenAborted,
} from '../consuming/index.ts';
import { CloseAbortedError, type CloseOptions, MessagingClosedError } from './closed.ts';
import { InFlight } from './in-flight.ts';

/** The core's view of one connection: a Broker's, as `messaging()` runs it, or the memory's own, to which the core hands each consumer as it built it. */
export type CoreConnection = Pick<BrokerConnection, 'publish' | 'close'> & {
  readonly consume: (consumers: readonly CoreConsumer[], run: ConsumeRun) => Promise<void>;
};

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

/** What the consumers of one `consume` are built with: `received`, and what ends a delivery early. */
export type ConsumerLife = { readonly received: Received; readonly ends: DeliveryEnds };

/**
 * The life of one messaging over its connection: publishing while open or closing, since a
 * Handler running may still publish; consuming once; and closed the moment nothing is in flight,
 * the deliveries settling, a `publish`, a `send`, a `consume` or a trouble report, or once `close`'s
 * signal aborts, handing back each delivery still settling. The core, not the adapter, keeps what
 * is in flight.
 */
export class MessagingLife {
  readonly #connection: CoreConnection;
  #state: State = { kind: 'open', consumption: 'none' };
  readonly #closing = new AbortController();
  readonly #inFlight = new InFlight(() => this.#endedIfIdle());

  constructor(connection: CoreConnection) {
    this.#connection = connection;
  }

  /** The connection to publish and send through, until messaging is closed. */
  connectionOf(): CoreConnection {
    switch (this.#state.kind) {
      case 'open':
      case 'closing':
        return this.#connection;
      case 'closed':
        throw new MessagingClosedError('closed');
    }
  }

  /** A call in flight, a `publish`, a `send`, the adapter's `consume` or a trouble report, which `close` waits for. */
  tracked<Result>(call: Promise<Result>): Promise<Result> {
    return this.#inFlight.tracked(call);
  }

  /**
   * Hands the broker its consumers, once, built with `received`, which runs a delivery only while
   * open, and where it tells of their trouble, which once closing started it drops; a broker that
   * rejects them leaves `consume` to retry.
   */
  async consume(
    consumersOf: (life: ConsumerLife) => readonly CoreConsumer[],
    tellTrouble: TroubleTell,
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
    const closing = this.#closing.signal;
    const consumers = consumersOf({
      received: (settle, named) => (delivery) => this.#received(settle, named, delivery),
      ends: { closing, handingBack: this.#inFlight.handingBack },
    });
    this.#consumption('taken');
    const tracked: TroubleTell = (trouble) => this.tracked(tellTrouble(trouble));
    const run: ConsumeRun = { closing, troubled: troubledOf(consumers, closing, tracked) };
    try {
      await this.tracked(this.#connection.consume(consumers, run));
    } catch (e) {
      this.#consumption('none');
      throw e;
    }
  }

  /**
   * Stops consuming, waits for everything in flight and closes the connection; once a call's
   * `signal` aborts, it hands back each delivery still settling instead. Called again, the same promise.
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
        const { messageId, factId } = delivery;
        return this.#inFlight.delivering(settle(delivery), { ...named, messageId, factId });
      }
    }
  }

  /** Closing stops waiting once the signal aborts, or at once if it has; its listener goes once closed. */
  #stoppedBy(signal: AbortSignal | undefined, closed: Promise<void>): void {
    if (signal === undefined) {
      return;
    }
    const stop = () => this.#ended({ kind: 'stopped', reason: signal.reason });
    whenAborted(signal, stop);
    const forget = () => signal.removeEventListener('abort', stop);
    closed.then(forget, forget);
  }

  /** Closes the connection once closing ended; stopped, after handing back each delivery still settling, naming it. */
  async #closedAfter(end: Ended): Promise<void> {
    if (end.kind === 'idle') {
      await this.#connection.close();
      return;
    }
    const handedBack = await this.#inFlight.handedBack();
    await this.#connection.close();
    if (handedBack.length > 0) {
      throw new CloseAbortedError(handedBack, end.reason);
    }
  }

  /** Closing ends the moment nothing is in flight, so a call is either waited for or throws. */
  #endedIfIdle(): void {
    if (this.#inFlight.isIdle) {
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
