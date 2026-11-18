import { type Token, wordOf, wordsOf } from '@cf-loom/contract/internal';
import type { About } from './faults.ts';

/** What names a Message in a line: the declaration handling it, its subject, Broker message id and Fact id. */
export type MessageNamed = Pick<About, 'name' | 'subject' | 'messageId' | 'factId'>;

/** A Message as a line names it: its declaration's name, subject, Broker message id and Fact id, each one word. */
export function messageWordsOf({ name, subject, messageId, factId }: MessageNamed): Token {
  return wordsOf([wordOf(name), wordOf(subject), wordOf(messageId), wordOf(factId)]);
}
