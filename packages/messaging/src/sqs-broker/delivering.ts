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
import type { Settlement } from '../broker/index.ts';
import { deliveryWaitOf } from '../broker-limits/index.ts';
import type { FoundQueue } from './queue-finding.ts';

/** What one Durable consumer's loop works with: the SQS client and `closing`, which aborts when the core starts closing. */
export type QueueRun = { readonly sqs: SQSClient; readonly closing: AbortSignal };

/** A Message received from a Durable consumer's queue. */
export type ReceivedMessage = { readonly queue: FoundQueue; readonly message: Message };

/** Hands one received Message to its Handler and applies the Settlement it comes back with. */
export async function deliver(run: QueueRun, { queue, message }: ReceivedMessage): Promise<void> {
  const attributes = {
    [snsMessageIdAttribute]: message.MessageAttributes?.[snsMessageIdAttribute]?.StringValue,
    [snsFactIdAttribute]: message.MessageAttributes?.[snsFactIdAttribute]?.StringValue,
    [snsHeadersAttribute]: message.MessageAttributes?.[snsHeadersAttribute]?.StringValue,
  };
  const read = receivedSnsAttributesOf(attributes);
  if (read.kind === 'missing') {
    return;
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
  const settlement = await queue.durableConsumer.receive(delivery);
  await settle(run, { queue, message }, settlement);
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
