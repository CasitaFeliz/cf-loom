// biome-ignore-all lint/style/useNamingConvention: SQS spells its fields in PascalCase
import { type Message, ReceiveMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { snsAttributeNames } from '@cf-loom/contract/internal';

/** How long, in seconds, one receive waits for a Message, SQS's longest long poll. */
const longPollSeconds = 20;

/** What one receive came back with: a Message, none because the poll ended empty, or a failure with its cause. */
export type Pull =
  | { readonly kind: 'message'; readonly message: Message }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly cause: unknown };

/** Receives at most one Message from the queue, with its receive count and the attributes cf-loom reads. */
export async function receiveOnce(sqs: SQSClient, queueUrl: string): Promise<Pull> {
  try {
    const received = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: longPollSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        MessageAttributeNames: [...snsAttributeNames],
      }),
    );
    const [message] = received.Messages ?? [];
    return message === undefined ? { kind: 'none' } : { kind: 'message', message };
  } catch (cause) {
    return { kind: 'failed', cause };
  }
}
