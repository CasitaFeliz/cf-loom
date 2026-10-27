import type { BrokerAck, ConsumeRun, OutgoingMessage } from '../broker/index.ts';
import { type CoreConsumer, whenAborted } from '../consuming/index.ts';
import type { CoreConnection } from '../messaging/index.ts';
import { type Attempt, firstDeliveryOf } from './attempts.ts';
import type { Deliveries } from './deliveries.ts';
import { Recorded } from './recorded.ts';
import type { RecordedMessage } from './types.ts';

/** The connection of a `memory()`: records what the Service publishes and sends, and lines it up for the consumers of its subject. */
export class MemoryConnection implements CoreConnection {
  readonly #deliveries: Deliveries;
  readonly #recorded = new Recorded();
  #consumers: readonly CoreConsumer[] = [];
  #closed = false;

  constructor(deliveries: Deliveries) {
    this.#deliveries = deliveries;
  }

  readonly publish = async (message: OutgoingMessage): Promise<BrokerAck> => {
    if (this.#recorded.add(message) === 'duplicate') {
      return { duplicate: true };
    }
    const delivery = firstDeliveryOf(message);
    const attempts = this.#consumers
      .filter((consumer) => consumer.subject === message.subject)
      .map((consumer): Attempt => ({ consumer, delivery }));
    this.#deliveries.lineUp(attempts);
    return { duplicate: false };
  };

  readonly consume = async (consumers: readonly CoreConsumer[], run: ConsumeRun): Promise<void> => {
    this.#consumers = consumers;
    whenAborted(run.closing, () => this.#deliveries.leaveLined());
  };

  readonly close = async (): Promise<void> => {
    this.#closed = true;
  };

  consumers(): readonly CoreConsumer[] {
    return this.#consumers;
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
