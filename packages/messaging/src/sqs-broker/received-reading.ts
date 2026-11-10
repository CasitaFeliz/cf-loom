// biome-ignore-all lint/style/useNamingConvention: SQS spells its fields in PascalCase
import type { Message } from '@aws-sdk/client-sqs';
import { joinedOf, logOf, receivedSnsAttributesOf, wordOf } from '@cf-loom/contract/internal';
import { deliveryOf, type TimedDelivery } from '../broker/index.ts';
import type { FoundQueue } from './queue-finding.ts';

/** A Message received from a Durable consumer's queue. */
export type ReceivedMessage = { readonly queue: FoundQueue; readonly message: Message };

/** A received Message read: the Delivery for its Handler, with its wait, or the names of what cf-loom cannot read of it. */
export type ReceivedReading =
  | { readonly kind: 'readable'; readonly delivery: TimedDelivery }
  | { readonly kind: 'unreadable'; readonly names: readonly string[] };

/** The system attribute SQS counts a Message's receives in. */
export const receiveCountAttribute = 'ApproximateReceiveCount';

/** Reads the Message by the wire and by SQS's receive count; one that lacks or cannot read any of them is unreadable, naming each. */
export function readingOf({ queue, message }: ReceivedMessage): ReceivedReading {
  const read = receivedSnsAttributesOf(message.MessageAttributes);
  const deliveryCount = receiveCountOf(message);
  if (read.kind === 'missing' || deliveryCount === undefined) {
    const unreadCount = deliveryCount === undefined ? [receiveCountAttribute] : [];
    const names = [...(read.kind === 'missing' ? read.names : []), ...unreadCount];
    return { kind: 'unreadable', names };
  }
  const limits = { waits: queue.waits, maxDeliver: queue.maxReceiveCount };
  const body = new TextEncoder().encode(message.Body ?? '');
  const held = { messageId: read.messageId, factId: read.factId, headers: read.headers, body };
  return { kind: 'readable', delivery: deliveryOf(limits, held, deliveryCount) };
}

/** How many times SQS has received the Message, a whole number from 1 as SQS counts them; `undefined` when it says otherwise. */
function receiveCountOf(message: Message): number | undefined {
  const text = message.Attributes?.[receiveCountAttribute];
  const count = text !== undefined && /^[1-9]\d*$/.test(text) ? Number(text) : Number.NaN;
  return Number.isSafeInteger(count) ? count : undefined;
}

/** Says that the Message is left alone, so the redrive moves it intact to the dead-letter queue, and why: it is not one cf-loom published. */
export function leftForTheDeadLetterQueue(
  { queue, message }: ReceivedMessage,
  names: readonly string[],
): void {
  console.error(
    ...logOf(
      `${queue.name}: left SQS message ${message.MessageId} for the dead-letter queue, since it lacks or cannot read ${joinedOf(names.map(wordOf), 'and')}`,
    ),
  );
}
