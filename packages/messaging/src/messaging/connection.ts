import type {
  Broker,
  BrokerConnection,
  BrokerConsumer,
  BrokerService,
  Delivery,
  Settlement,
} from '../broker/index.ts';

/** Where one messaging is in its life, with its connection while it has one. */
type State =
  | { readonly kind: 'not-connected' }
  | { readonly kind: 'connecting' }
  | {
      readonly kind: 'connected';
      readonly connection: BrokerConnection;
      readonly consumed: boolean;
    }
  | {
      readonly kind: 'closing';
      readonly connection: BrokerConnection;
      readonly closed: Promise<void>;
    };

const pendingWhileClosing: Settlement = { kind: 'pending', fault: undefined };

/**
 * One messaging's connection over its life: connecting, publishing while connected or closing,
 * consuming once per connection, and closing once every Handler running has settled; the core,
 * not the adapter, keeps the Handlers running.
 */
export class Connection {
  #state: State = { kind: 'not-connected' };
  readonly #running = new Set<Promise<Settlement>>();

  /** Connects a broker; a broker that fails leaves it not connected. */
  async connect(broker: Broker, service: BrokerService): Promise<void> {
    if (this.#state.kind !== 'not-connected') {
      throw new Error(`messaging is already ${this.#state.kind}: close() it first`);
    }
    this.#state = { kind: 'connecting' };
    try {
      const connection = await broker.connect(service);
      this.#state = { kind: 'connected', connection, consumed: false };
    } catch (e) {
      this.#state = { kind: 'not-connected' };
      throw e;
    }
  }

  /** The connection to publish and send through, while connected or closing, since a Handler running may still publish. */
  sending(): BrokerConnection {
    if (this.#state.kind === 'connected' || this.#state.kind === 'closing') {
      return this.#state.connection;
    }
    throw new Error('messaging is not connected: call connect(broker) first');
  }

  /** Hands the broker its consumers, once per connection, each tracked while its Handler runs. */
  async consume(consumersOf: () => readonly BrokerConsumer[]): Promise<void> {
    const state = this.#state;
    if (state.kind !== 'connected') {
      throw new Error(`messaging is ${notConnectedOf(state)}: call connect(broker) first`);
    }
    if (state.consumed) {
      throw new Error('consume() was already called on this connection');
    }
    const consumers = consumersOf().map((consumer) => this.#tracked(consumer));
    this.#state = { ...state, consumed: true };
    await state.connection.consume(consumers);
  }

  /** Stops consuming, waits for the Handlers running and closes the connection; nothing to do when not connected. */
  async close(): Promise<void> {
    const state = this.#state;
    switch (state.kind) {
      case 'not-connected':
        return;
      case 'connecting':
        throw new Error('messaging is connecting: await connect() before close()');
      case 'closing':
        return state.closed;
      case 'connected': {
        const closed = this.#closed(state.connection);
        this.#state = { kind: 'closing', connection: state.connection, closed };
        return closed;
      }
    }
  }

  #tracked(consumer: BrokerConsumer): BrokerConsumer {
    return { ...consumer, receive: (delivery) => this.#received(consumer, delivery) };
  }

  /** A delivery while connected runs its Handler; any other is left pending, its Handler never run. */
  #received(consumer: BrokerConsumer, delivery: Delivery): Promise<Settlement> {
    if (this.#state.kind !== 'connected') {
      return Promise.resolve(pendingWhileClosing);
    }
    const settled = consumer.receive(delivery);
    const forget = () => this.#running.delete(settled);
    this.#running.add(settled);
    settled.then(forget, forget);
    return settled;
  }

  async #closed(connection: BrokerConnection): Promise<void> {
    await Promise.allSettled(this.#running);
    try {
      await connection.close();
    } finally {
      this.#state = { kind: 'not-connected' };
    }
  }
}

function notConnectedOf(state: Exclude<State, { kind: 'connected' }>): string {
  return state.kind === 'closing' ? 'closing' : 'not connected';
}
