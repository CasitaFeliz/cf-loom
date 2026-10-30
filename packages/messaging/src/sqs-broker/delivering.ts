// biome-ignore-all lint/style/useNamingConvention: SQS spells its fields in PascalCase
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  receivedSnsAttributesOf,
  snsFactIdAttribute,
  snsHeadersAttribute,
  snsMessageIdAttribute,
} from '@cf-loom/contract/internal';
import type { Delivery, Settlement } from '../broker/index.ts';
import { deliveryWaitOf } from '../broker-limits/index.ts';
import type { FoundQueue } from './queue-finding.ts';

/** What one Durable consumer's loop works with: the SQS client and `closing`, which aborts when the core starts closing. */
export type QueueRun = { readonly sqs: SQSClient; readonly closing: AbortSignal };

/** A Message received from a Durable consumer's queue. */
export type ReceivedMessage = { readonly queue: FoundQueue; readonly message: Message };

/** A received Message made ready for its Handler, or why it is not: none to deliver, or a failure of the visibility change that comes before it. */
export type Prepared =
  | { readonly kind: 'ready'; readonly delivery: Delivery }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly cause: unknown };

/** Reads the Message into the Delivery its Handler runs with, and gives it the wait of a later delivery on a queue with a backoff; one cf-loom cannot read is none. */
export async function preparedFrom(run: QueueRun, received: ReceivedMessage): Promise<Prepared> {
  const reading = readingOf(received);
  if (reading.kind === 'unreadable') {
    leftForTheDeadLetterQueue(received, reading.names);
    return { kind: 'none' };
  }
  const { delivery } = reading;
  const changed = await changedVisibility(run, received, delivery);
  return changed.kind === 'failed' ? changed : { kind: 'ready', delivery };
}

type Reading =
  | { readonly kind: 'readable'; readonly delivery: Delivery }
  | { readonly kind: 'unreadable'; readonly names: readonly string[] };

function readingOf({ queue, message }: ReceivedMessage): Reading {
  const attributes = {
    [snsMessageIdAttribute]: message.MessageAttributes?.[snsMessageIdAttribute]?.StringValue,
    [snsFactIdAttribute]: message.MessageAttributes?.[snsFactIdAttribute]?.StringValue,
    [snsHeadersAttribute]: message.MessageAttributes?.[snsHeadersAttribute]?.StringValue,
  };
  const read = receivedSnsAttributesOf(attributes);
  if (read.kind === 'missing') {
    return { kind: 'unreadable', names: read.names };
  }
  const deliveryCount = Number(message.Attributes?.['ApproximateReceiveCount']);
  const delivery = {
    messageId: read.messageId,
    factId: read.factId,
    deliveryCount,
    lastAttempt: deliveryCount >= queue.maxReceiveCount,
    waitMs: deliveryWaitOf(queue.waits, deliveryCount),
    headers: read.headers,
    body: new TextEncoder().encode(message.Body ?? ''),
  };
  return { kind: 'readable', delivery };
}

/** Says that the Message is left alone, so the redrive moves it intact to the dead-letter queue, and why: it is not one cf-loom published. */
function leftForTheDeadLetterQueue(
  { queue, message }: ReceivedMessage,
  names: readonly string[],
): void {
  console.error(
    `${queue.name}: left SQS message ${message.MessageId} for the dead-letter queue, since it lacks or cannot read ${names.join(', ')}`,
  );
}

/** Gives a delivery after the first the wait of its backoff entry, which the queue's own visibility timeout does not know. */
async function changedVisibility(
  { sqs }: QueueRun,
  { queue, message }: ReceivedMessage,
  delivery: Delivery,
): Promise<{ readonly kind: 'changed' } | { readonly kind: 'failed'; readonly cause: unknown }> {
  if (delivery.deliveryCount === 1 || queue.waits.length === 1) {
    return { kind: 'changed' };
  }
  const seconds = (delivery.waitMs ?? 0) / 1_000;
  try {
    await sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queue.url,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
    return { kind: 'changed' };
  } catch (cause) {
    return { kind: 'failed', cause };
  }
}

/** Hands a Delivery to its Handler and applies the Settlement it comes back with. */
export async function deliver(
  run: QueueRun,
  received: ReceivedMessage,
  delivery: Delivery,
): Promise<void> {
  const settlement = await received.queue.durableConsumer.receive(delivery);
  await settle(run, received, settlement);
}

async function settle(
  { sqs }: QueueRun,
  { queue, message }: ReceivedMessage,
  settlement: Settlement,
): Promise<void> {
  const target = { QueueUrl: queue.url, ReceiptHandle: message.ReceiptHandle };
  switch (settlement) {
    case 'acked':
    case 'ended':
      await sqs.send(new DeleteMessageCommand(target));
      return;
    case 'pending':
      return;
    case 'handed-back':
      await sqs.send(new ChangeMessageVisibilityCommand({ ...target, VisibilityTimeout: 0 }));
      return;
  }
}
