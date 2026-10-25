import type { BrokerConnection, BrokerConsumer, Delivery } from '../broker/index.ts';
import type { Settle, Settled } from '../consuming/index.ts';
import { MessagingClosedError } from './closed.ts';

/** Whether a `consume` has handed the broker its consumers, or is handing them: taken until the broker rejects them. */
type Consumption = 'none' | 'taken';

/** Where one messaging is in its life: open, closing while what is in flight settles, or closed. */
type State =
  | { readonly kind: 'open'; readonly consumption: Consumption }
  | { readonly kind: 'closing'; readonly closed: Promise<void>; readonly idle: () => void }
  | { readonly kind: 'closed'; readonly closed: Promise<void> };

const leftPending: Settled = { settlement: 'pending', fault: undefined, hookFailure: undefined };

/**
 * The life of one messaging over its broker connection: publishing while open or closing, since a
 * Handler running may still publish; consuming once; and closed the moment nothing is in flight,
 * the Handlers running, a `publish`, a `send` or a `consume`. The core, not the adapter, keeps what
 * is in flight.
 */
export class MessagingLife {
  readonly #connection: BrokerConnection;
  #state: State = { kind: 'open', consumption: 'none' };
  readonly #closing = new AbortController();
  readonly #inFlight = new Set<Promise<unknown>>();

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

  /** A call in flight, a `publish`, a `send`, the adapter's `consume` or a Handler running, which `close` waits for. */
  tracked<Settled>(call: Promise<Settled>): Promise<Settled> {
    this.#inFlight.add(call);
    const forget = () => this.#forget(call);
    call.then(forget, forget);
    return call;
  }

  /**
   * Hands the broker its consumers, once, built with `received`, which runs a delivery only while
   * open; a broker that rejects them leaves `consume` to retry.
   */
  async consume(
    consumersOf: (received: (settle: Settle) => Settle) => readonly BrokerConsumer[],
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
    const consumers = consumersOf((settle) => (delivery) => this.#received(settle, delivery));
    this.#consumption('taken');
    try {
      await this.tracked(this.#connection.consume(consumers, this.#closing.signal));
    } catch (e) {
      this.#consumption('none');
      throw e;
    }
  }

  /** Stops consuming, waits for everything in flight and closes the broker connection; called again, the same promise. */
  close(): Promise<void> {
    const state = this.#state;
    switch (state.kind) {
      case 'open': {
        this.#closing.abort();
        const idle = Promise.withResolvers<void>();
        const closed = idle.promise.then(() => this.#connection.close());
        this.#state = { kind: 'closing', closed, idle: idle.resolve };
        this.#endedIfIdle();
        return closed;
      }
      case 'closing':
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
  #received(settle: Settle, delivery: Delivery): Promise<Settled> {
    switch (this.#state.kind) {
      case 'closing':
      case 'closed':
        return Promise.resolve(leftPending);
      case 'open':
        return this.tracked(settle(delivery));
    }
  }

  #forget(call: Promise<unknown>): void {
    this.#inFlight.delete(call);
    this.#endedIfIdle();
  }

  /** Closing ends closed the moment nothing is in flight, so a call is either waited for or throws. */
  #endedIfIdle(): void {
    const state = this.#state;
    switch (state.kind) {
      case 'closing':
        if (this.#inFlight.size === 0) {
          this.#state = { kind: 'closed', closed: state.closed };
          state.idle();
        }
        return;
      case 'open':
      case 'closed':
        return;
    }
  }
}
