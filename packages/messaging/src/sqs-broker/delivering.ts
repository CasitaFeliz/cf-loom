// biome-ignore-all lint/style/useNamingConvention: SQS spells its fields in PascalCase
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { Delivery, Settlement, TimedDelivery } from '../broker/index.ts';
import { leftForTheDeadLetterQueue, type ReceivedMessage, readingOf } from './received-reading.ts';
import type { Refusals } from './refusals.ts';

/** What one Durable consumer's loop works with: the SQS client, `closing`, which aborts when the core starts closing, and where a Settlement SQS refused at closing is noted. */
export type QueueRun = {
  readonly sqs: SQSClient;
  readonly closing: AbortSignal;
  readonly refusals: Refusals;
};

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
  const changed = await changedVisibility(run, received, reading.delivery);
  return changed.kind === 'failed' ? changed : { kind: 'ready', delivery: reading.delivery };
}

/** Gives a delivery after the first the wait of its backoff entry, which the queue's own visibility timeout does not know. */
async function changedVisibility(
  { sqs }: QueueRun,
  { queue, message }: ReceivedMessage,
  { deliveryCount, waitMs }: TimedDelivery,
): Promise<{ readonly kind: 'changed' } | { readonly kind: 'failed'; readonly cause: unknown }> {
  if (deliveryCount === 1 || queue.waits.length === 1) {
    return { kind: 'changed' };
  }
  try {
    await sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queue.url,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: waitMs / 1_000,
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

/** Hands a Message back to the queue unread, as one received once closing started is. */
export function handBack(run: QueueRun, received: ReceivedMessage): Promise<void> {
  return settle(run, received, 'handed-back');
}

/** Applies the Settlement with SQS's calls; one SQS refuses is told to nobody before closing started, as a JetStream acknowledgement is never heard of, and the Message comes back after its wait, and noted for `close` after. */
async function settle(
  run: QueueRun,
  received: ReceivedMessage,
  settlement: Settlement,
): Promise<void> {
  try {
    await settlementApplied(run, received, settlement);
  } catch (error) {
    if (run.closing.aborted) {
      run.refusals.refused(received.queue.durable, error);
    }
  }
}

async function settlementApplied(
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
