import type { BrokerConnection, BrokerConsumer, Delivery, Settlement } from '../broker/index.ts';

/** Whether a `consume` has handed the broker its consumers, or is handing them: taken until the broker rejects them. */
type Consumption = 'none' | 'taken';

/** Where one messaging is in its life: open, closing while what is in flight settles, or closed. */
type State =
  | { readonly kind: 'open'; readonly consumption: Consumption }
  | { readonly kind: 'closing'; readonly closed: Promise<void>; readonly idle: () => void }
  | { readonly kind: 'closed'; readonly closed: Promise<void> };

const leftPending: Settlement = { kind: 'pending', fault: undefined };

/**
 * The life of one messaging over its broker connection: publishing while open or closing, since a
 * Handler running may still publish; consuming once; and closed the moment nothing is in flight,
 * the Handlers running, a `publish`, a `send` or a `consume`. The core, not the adapter, keeps what
 * is in flight.
 */
export class MessagingLife {
  readonly #connection: BrokerConnection;
  #state: State = { kind: 'open', consumption: 'none' };
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
        throw new Error('messaging is closed');
    }
  }

  /** A call in flight, a `publish`, a `send`, the adapter's `consume` or a Handler running, which `close` waits for. */
  tracked<Settled>(call: Promise<Settled>): Promise<Settled> {
    this.#inFlight.add(call);
    const forget = () => this.#forget(call);
    call.then(forget, forget);
    return call;
  }

  /** Hands the broker its consumers, once; a broker that rejects them leaves `consume` to retry. */
  async consume(consumersOf: () => readonly BrokerConsumer[]): Promise<void> {
    const state = this.#state;
    switch (state.kind) {
      case 'closing':
      case 'closed':
        throw new Error(`messaging is ${state.kind}`);
      case 'open':
        if (state.consumption === 'taken') {
          throw new Error('consume() was already called on this messaging');
        }
    }
    const consumers = consumersOf().map((consumer) => this.#trackedConsumer(consumer));
    this.#consumption('taken');
    try {
      await this.tracked(this.#connection.consume(consumers));
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

  #trackedConsumer(consumer: BrokerConsumer): BrokerConsumer {
    return { ...consumer, receive: (delivery) => this.#received(consumer, delivery) };
  }

  /** A delivery while open runs its Handler; one while closing or closed is left pending, its Handler never run. */
  #received(consumer: BrokerConsumer, delivery: Delivery): Promise<Settlement> {
    switch (this.#state.kind) {
      case 'closing':
      case 'closed':
        return Promise.resolve(leftPending);
      case 'open':
        return this.tracked(consumer.receive(delivery));
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
