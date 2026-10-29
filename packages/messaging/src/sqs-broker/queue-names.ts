import { createHash } from 'node:crypto';

/** SQS allows 80 characters in a queue name; the dead-letter queue's `_dlq` takes 4. */
const longestName = 76;
const keptCharacters = 63;
const hashDigits = 12;

/** A Durable consumer's queue name: the Durable consumer's name when it fits, else its first 63 characters, `-` and 12 hex digits of its SHA-256, 76 in all. */
export function queueNameOf(durableConsumer: string): string {
  if (durableConsumer.length <= longestName) {
    return durableConsumer;
  }
  const digest = createHash('sha256').update(durableConsumer).digest('hex').slice(0, hashDigits);
  return `${durableConsumer.slice(0, keptCharacters)}-${digest}`;
}

/** The dead-letter queue's name: its queue's name with `_dlq`, so it is no Durable consumer's queue. */
export function deadLetterQueueNameOf(durableConsumer: string): string {
  return `${queueNameOf(durableConsumer)}_dlq`;
}
