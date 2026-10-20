import type { BrokerConnection, BrokerConsumer, Delivery, Settlement } from '../broker/index.ts';

/** Whether a `consume` has handed the broker its consumers, or is handing them: taken until the broker rejects them. */
type Consumption = 'none' | 'taken';

/** Where one messaging is in its life: open, closing while what is in flight settles, or closed. */
type State =
  | { readonly kind: 'open'; readonly consumption: Consumption }
  | { readonly kind: 'closing'; readonly closed: Promise<void> }
  | { readonly kind: 'closed'; readonly closed: Promise<void> };

const leftPending: Settlement = { kind: 'pending', fault: undefined };

/**
 * The life of one messaging over its broker connection: publishing while open or closing, since a
 * Handler running may still publish; consuming once; and closing once everything in flight, the
 * Handlers running, a `publish`, a `send` or a `consume`, has settled. The core, not the adapter,
 * keeps what is in flight.
 */
export class MessagingLife {
  readonly #connection: BrokerConnection;
  #state: State = { kind: 'open', consumption: 'none' };
  readonly #inFlight = new Set<Promise<unknown>>();
  #idle: (() => void) | undefined;

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
    if (this.#inFlight.size === 0) {
      this.#idle?.();
    }
  }

  /** Settles once nothing is in flight, however many calls start while it waits. */
  #settled(): Promise<void> {
    if (this.#inFlight.size === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#idle = resolve;
    });
  }

  /**
   * Waits until nothing is in flight, a call started in the microtask after one settles included,
   * then closes; it awaits at least once, so `close()` has set the state to closing first.
   */
  async #closed(): Promise<void> {
    do {
      await this.#settled();
    } while (this.#inFlight.size > 0);
    this.#ended();
    await this.#connection.close();
  }

  /** Closing ends closed, keeping the promise every `close()` returns, so nothing new starts. */
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
