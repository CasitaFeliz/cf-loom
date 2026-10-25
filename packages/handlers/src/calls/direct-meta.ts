import type { Command, Event } from '@cf-loom/contract';
import { brokerMessageIdOf } from '@cf-loom/contract/internal';
import type { MessageMeta } from './message-run.ts';

/** The meta a direct call takes: each part left out gets the default `deliver` gives it. */
export type DirectMeta = Partial<MessageMeta>;

/** A Message's meta as a test gives it, each part left out defaulted: a random Fact id, the broker message id derived from it, attempt 1, not the last, no headers and a signal never aborted. */
export function defaultedMetaOf(message: Event | Command, given: DirectMeta): MessageMeta {
  const factId = given.factId ?? globalThis.crypto.randomUUID();
  return {
    messageId: given.messageId ?? brokerMessageIdOf(message, factId),
    factId,
    deliveryCount: given.deliveryCount ?? 1,
    lastAttempt: given.lastAttempt ?? false,
    headers: given.headers ?? {},
    signal: given.signal ?? new AbortController().signal,
  };
}
