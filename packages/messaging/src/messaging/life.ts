import type { BrokerConnection, BrokerConsumer, Delivery, Settlement } from '../broker/index.ts';

/** Whether `consume` has handed the broker its consumers: not yet, while the broker takes them, or done. */
type Consumption = 'none' | 'pending' | 'done';

/** Where one messaging is in its life: open, closing while its Handlers finish, or closed. */
type State =
  | { readonly kind: 'open'; readonly consumption: Consumption }
  | { readonly kind: 'closing'; readonly closed: Promise<void> }
  | { readonly kind: 'closed'; readonly closed: Promise<void> };

const leftPending: Settlement = { kind: 'pending', fault: undefined };

/**
 * The life of one messaging over its broker connection: publishing while open or closing, since a
 * Handler running may still publish; consuming once; and closing once every Handler running has
 * settled. The core, not the adapter, keeps the Handlers running.
 */
export class MessagingLife {
  readonly #connection: BrokerConnection;
  #state: State = { kind: 'open', consumption: 'none' };
  readonly #running = new Set<Promise<Settlement>>();

  constructor(connection: BrokerConnection) {
    this.#connection = connection;
  }

  /** The broker connection to publish and send through, until messaging is closed. */
  sending(): BrokerConnection {
    switch (this.#state.kind) {
      case 'open':
      case 'closing':
        return this.#connection;
      case 'closed':
        throw new Error('messaging is closed');
    }
  }

  /** Hands the broker its consumers, once; a broker that rejects them leaves `consume` to retry. */
  async consume(consumersOf: () => readonly BrokerConsumer[]): Promise<void> {
    const state = this.#state;
    switch (state.kind) {
      case 'closing':
      case 'closed':
        throw new Error(`messaging is ${state.kind}`);
      case 'open':
        if (state.consumption !== 'none') {
          throw new Error('consume() was already called on this messaging');
        }
    }
    const consumers = consumersOf().map((consumer) => this.#tracked(consumer));
    this.#consumption('pending');
    try {
      await this.#connection.consume(consumers);
    } catch (e) {
      this.#consumption('none');
      throw e;
    }
    this.#consumption('done');
  }

  /** Stops consuming, waits for the Handlers running and closes the broker connection; called again, the same promise. */
  close(): Promise<void> {
    const state = this.#state;
    switch (state.kind) {
      case 'open': {
        const closed = this.#closed();
        this.#state = { kind: 'closing', closed };
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

  #tracked(consumer: BrokerConsumer): BrokerConsumer {
    return { ...consumer, receive: (delivery) => this.#received(consumer, delivery) };
  }

  /** A delivery while open runs its Handler; one while closing or closed is left pending, its Handler never run. */
  #received(consumer: BrokerConsumer, delivery: Delivery): Promise<Settlement> {
    switch (this.#state.kind) {
      case 'closing':
      case 'closed':
        return Promise.resolve(leftPending);
      case 'open': {
        const settled = consumer.receive(delivery);
        const forget = () => this.#running.delete(settled);
        this.#running.add(settled);
        settled.then(forget, forget);
        return settled;
      }
    }
  }

  async #closed(): Promise<void> {
    await Promise.allSettled(this.#running);
    try {
      await this.#connection.close();
    } finally {
      this.#ended();
    }
  }

  /** Closing ends closed, keeping the promise every `close()` returns. */
  #ended(): void {
    const state = this.#state;
    switch (state.kind) {
      case 'closing':
        this.#state = { kind: 'closed', closed: state.closed };
        return;
      case 'open':
      case 'closed':
        return;
    }
  }
}
