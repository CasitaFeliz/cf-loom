import type { BrokerConsumer } from '../broker/index.ts';
import { consumerDetailsOf } from '../consuming/index.ts';
import type { Attempt } from './attempts.ts';
import { jsonBodyOf } from './bodies.ts';
import type { PendingMessage } from './types.ts';

/** The Messages left unacknowledged, by consumer and broker message id, as each consumer last received them, in the order each first failed. */
export class PendingList {
  readonly #attempts = new Map<string, Attempt>();

  /** Lists a Message, or replaces the one of the same consumer and id where it stands. */
  put(attempt: Attempt): void {
    this.#attempts.set(keyOf(attempt.consumer, attempt.delivery.messageId), attempt);
  }

  leave(consumer: BrokerConsumer, messageId: string): void {
    this.#attempts.delete(keyOf(consumer, messageId));
  }

  attemptFor(consumer: BrokerConsumer, messageId: string): Attempt | undefined {
    return this.#attempts.get(keyOf(consumer, messageId));
  }

  attempts(): readonly Attempt[] {
    return [...this.#attempts.values()];
  }

  messages(): readonly PendingMessage[] {
    return this.attempts().map(pendingMessageOf);
  }
}

function keyOf(consumer: BrokerConsumer, messageId: string): string {
  return JSON.stringify([consumer.durable, messageId]);
}

function pendingMessageOf({ consumer, delivery }: Attempt): PendingMessage {
  const { messageId, factId, deliveryCount, headers, body } = delivery;
  const { element, identity } = consumerDetailsOf(consumer);
  const { subject } = consumer;
  const wire = jsonBodyOf(body);
  return { element, identity, subject, messageId, factId, deliveryCount, headers, body: wire };
}
