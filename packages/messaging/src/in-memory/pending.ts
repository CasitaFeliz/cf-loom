import type { BrokerConsumer, Delivery } from '../broker/index.ts';
import { jsonBodyOf } from './bodies.ts';
import type { PendingMessage } from './types.ts';

/** A Message one consumer left unacknowledged, as that consumer last received it. */
export type PendingEntry = { readonly consumer: BrokerConsumer; readonly delivery: Delivery };

/** The Messages left unacknowledged, by consumer and broker message id, in the order each first failed. */
export class PendingList {
  readonly #entries = new Map<string, PendingEntry>();

  /** Lists a Message, or replaces the entry of the same consumer and id where it stands. */
  put(entry: PendingEntry): void {
    this.#entries.set(keyOf(entry.consumer, entry.delivery.messageId), entry);
  }

  leave(consumer: BrokerConsumer, messageId: string): void {
    this.#entries.delete(keyOf(consumer, messageId));
  }

  entryFor(consumer: BrokerConsumer, messageId: string): PendingEntry | undefined {
    return this.#entries.get(keyOf(consumer, messageId));
  }

  entries(): readonly PendingEntry[] {
    return [...this.#entries.values()];
  }

  messages(): readonly PendingMessage[] {
    return this.entries().map(pendingMessageOf);
  }
}

function keyOf(consumer: BrokerConsumer, messageId: string): string {
  return JSON.stringify([consumer.durable, messageId]);
}

function pendingMessageOf({ consumer, delivery }: PendingEntry): PendingMessage {
  const { messageId, factId, deliveryCount, headers, body } = delivery;
  const { element, subject } = consumer;
  return { element, subject, messageId, factId, deliveryCount, headers, body: jsonBodyOf(body) };
}
