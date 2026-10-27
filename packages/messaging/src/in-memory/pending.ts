import type { CoreDurableConsumer } from '../consuming/index.ts';
import type { Attempt } from './attempts.ts';
import { jsonBodyOf } from './bodies.ts';
import type { PendingMessage } from './types.ts';

/** The Messages left unacknowledged, by Durable consumer and broker message id, as each Durable consumer last received them, in the order each first failed. */
export class PendingList {
  readonly #attempts = new Map<string, Attempt>();

  /** Lists a Message, or replaces the one of the same Durable consumer and id where it stands. */
  put(attempt: Attempt): void {
    this.#attempts.set(keyOf(attempt.durableConsumer, attempt.delivery.messageId), attempt);
  }

  leave(durableConsumer: CoreDurableConsumer, messageId: string): void {
    this.#attempts.delete(keyOf(durableConsumer, messageId));
  }

  attemptFor(durableConsumer: CoreDurableConsumer, messageId: string): Attempt | undefined {
    return this.#attempts.get(keyOf(durableConsumer, messageId));
  }

  attempts(): readonly Attempt[] {
    return [...this.#attempts.values()];
  }

  messages(): readonly PendingMessage[] {
    return this.attempts().map(pendingMessageOf);
  }
}

function keyOf(durableConsumer: CoreDurableConsumer, messageId: string): string {
  return JSON.stringify([durableConsumer.durable, messageId]);
}

function pendingMessageOf({ durableConsumer, delivery }: Attempt): PendingMessage {
  const { messageId, factId, deliveryCount, headers, body } = delivery;
  const { declaration, name, subject } = durableConsumer;
  const wire = jsonBodyOf(body);
  return { declaration, name, subject, messageId, factId, deliveryCount, headers, body: wire };
}
