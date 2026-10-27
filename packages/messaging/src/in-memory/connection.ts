import type { BrokerAck, ConsumeRun, OutgoingMessage } from '../broker/index.ts';
import { type CoreDurableConsumer, whenAborted } from '../consuming/index.ts';
import type { CoreConnection } from '../messaging/index.ts';
import { type Attempt, firstDeliveryOf } from './attempts.ts';
import type { Deliveries } from './deliveries.ts';
import { Recorded } from './recorded.ts';
import type { RecordedMessage } from './types.ts';

/** The connection of a `memory()`: records what the Service publishes and sends, and lines it up for the Durable consumers of its subject. */
export class MemoryConnection implements CoreConnection {
  readonly #deliveries: Deliveries;
  readonly #recorded = new Recorded();
  #durableConsumers: readonly CoreDurableConsumer[] = [];
  #closed = false;

  constructor(deliveries: Deliveries) {
    this.#deliveries = deliveries;
  }

  readonly publish = async (message: OutgoingMessage): Promise<BrokerAck> => {
    if (this.#recorded.add(message) === 'duplicate') {
      return { duplicate: true };
    }
    const delivery = firstDeliveryOf(message);
    const attempts = this.#durableConsumers
      .filter((durableConsumer) => durableConsumer.subject === message.subject)
      .map((durableConsumer): Attempt => ({ durableConsumer, delivery }));
    this.#deliveries.lineUp(attempts);
    return { duplicate: false };
  };

  readonly consume = async (
    durableConsumers: readonly CoreDurableConsumer[],
    run: ConsumeRun,
  ): Promise<void> => {
    this.#durableConsumers = durableConsumers;
    whenAborted(run.closing, () => this.#deliveries.leaveLined());
  };

  readonly close = async (): Promise<void> => {
    this.#closed = true;
  };

  durableConsumers(): readonly CoreDurableConsumer[] {
    return this.#durableConsumers;
  }

  messages(): readonly RecordedMessage[] {
    return this.#recorded.messages();
  }

  /** Throws once the connection is closed, as `deliver` and `redeliver` do. */
  assertOpen(): void {
    if (this.#closed) {
      throw new Error('memory connection is closed');
    }
  }
}
