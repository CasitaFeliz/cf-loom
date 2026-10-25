import type { Command, Event } from '@cf-loom/contract';
import { brokerMessageIdOf } from '@cf-loom/contract/internal';
import type { MessageMeta } from './message-run.ts';

/** The meta a direct call takes: each part left out is defaulted by `defaultedMetaOf`. */
export type DirectMeta = Partial<MessageMeta>;

/** A Message's first attempt, as a direct call and the in-memory `deliver` give it: attempt 1, not the last. */
export const firstAttempt = { deliveryCount: 1, lastAttempt: false } as const;

/** A Message's meta as a test gives it, each part left out defaulted as `deliver` defaults it: a random Fact id, the broker message id derived from it, the first attempt and no headers; and a signal never aborted. */
export function defaultedMetaOf(message: Event | Command, given: DirectMeta): MessageMeta {
  const factId = given.factId ?? globalThis.crypto.randomUUID();
  return {
    messageId: given.messageId ?? brokerMessageIdOf(message, factId),
    factId,
    deliveryCount: given.deliveryCount ?? firstAttempt.deliveryCount,
    lastAttempt: given.lastAttempt ?? firstAttempt.lastAttempt,
    headers: given.headers ?? {},
    signal: given.signal ?? new AbortController().signal,
  };
}
