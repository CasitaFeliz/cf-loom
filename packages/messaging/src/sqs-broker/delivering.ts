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

/** What one Durable consumer's loop works with: the SQS client, `closing`, which aborts when the core starts closing, and where a Settlement SQS refused at closing is noted. */
export type QueueRun = {
  readonly sqs: SQSClient;
  readonly closing: AbortSignal;
  readonly refusals: Refusals;
};

/** The Durable consumers of Messages that SQS refused to settle once closing started, which `close` rejects for. */
export type Refusals = {
  readonly refused: (durable: string, error: unknown) => void;
  /** The error `close` rejects with, or `undefined` when SQS refused nothing. */
  readonly error: () => Error | undefined;
};

/** A record of the Settlements SQS refused once closing started: each Durable consumer once, the first error of all as the cause. */
export function refusalsOf(): Refusals {
  const causes = new Map<string, unknown>();
  return {
    refused: (durable, error) => {
      if (!causes.has(durable)) {
        causes.set(durable, error);
      }
    },
    error: () => {
      const [cause] = causes.values();
      const durables = [...causes.keys()].join(', ');
      return causes.size === 0
        ? undefined
        : new Error(`SQS refused to settle Messages of the Durable consumers ${durables}`, {
            cause,
          });
    },
  };
}

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
    [snsMessageIdAttribute]: stringValueOf(message, snsMessageIdAttribute),
    [snsFactIdAttribute]: stringValueOf(message, snsFactIdAttribute),
    [snsHeadersAttribute]: stringValueOf(message, snsHeadersAttribute),
  };
  const read = receivedSnsAttributesOf(attributes);
  const deliveryCount = receiveCountOf(message);
  if (read.kind === 'missing' || deliveryCount === undefined) {
    const unreadCount = deliveryCount === undefined ? [receiveCountAttribute] : [];
    const names = [...(read.kind === 'missing' ? read.names : []), ...unreadCount];
    return { kind: 'unreadable', names };
  }
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

const receiveCountAttribute = 'ApproximateReceiveCount';

/** How many times SQS has received the Message, a whole number from 1 as SQS counts them; `undefined` when it says otherwise. */
function receiveCountOf(message: Message): number | undefined {
  const text = message.Attributes?.[receiveCountAttribute];
  const count = text !== undefined && /^[1-9]\d*$/.test(text) ? Number(text) : Number.NaN;
  return Number.isSafeInteger(count) ? count : undefined;
}

/** The text of a message attribute of the DataType `String`, which is how cf-loom sends them; an attribute of any other DataType counts as absent. */
function stringValueOf(message: Message, name: string): string | undefined {
  const attribute = message.MessageAttributes?.[name];
  return attribute?.DataType === 'String' ? attribute.StringValue : undefined;
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
