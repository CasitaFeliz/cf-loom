// biome-ignore-all lint/style/useNamingConvention: SQS spells its attributes and fields in PascalCase
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SetQueueAttributesCommand,
  type SQSClient,
  TagQueueCommand,
  UntagQueueCommand,
} from '@aws-sdk/client-sqs';
import { isAwsError } from './applied.ts';

/** A queue or dead-letter queue as the plan wants it: its attributes and tags, the tags it must not carry, and, for a queue that has one, how its policy follows from the policy it holds. */
export type QueueToApply = {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly tags: Readonly<Record<string, string>>;
  readonly untagged: readonly string[];
  readonly policy?: (held: string | undefined) => string;
};

/** Creates the queue with its attributes and tags, or sets them on the one that exists and keeps every other attribute and tag; answers its URL. */
export async function applyQueue(sqs: SQSClient, queue: QueueToApply): Promise<string> {
  const url = await urlOf(sqs, queue.name);
  if (url === undefined) {
    return await create(sqs, queue);
  }
  await update(sqs, url, queue);
  return url;
}

/** Adds tags to a queue, keeping the ones it has. */
export async function tagQueue(
  sqs: SQSClient,
  url: string,
  tags: Readonly<Record<string, string>>,
): Promise<void> {
  await sqs.send(new TagQueueCommand({ QueueUrl: url, Tags: { ...tags } }));
}

async function urlOf(sqs: SQSClient, name: string): Promise<string | undefined> {
  try {
    const found = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    return found.QueueUrl;
  } catch (error) {
    if (isAwsError(error, 'QueueDoesNotExist')) {
      return undefined;
    }
    throw error;
  }
}

async function create(sqs: SQSClient, queue: QueueToApply): Promise<string> {
  const Attributes = withPolicy(queue, undefined);
  const created = await sqs.send(
    new CreateQueueCommand({ QueueName: queue.name, Attributes, tags: { ...queue.tags } }),
  );
  return created.QueueUrl ?? '';
}

async function update(sqs: SQSClient, url: string, queue: QueueToApply): Promise<void> {
  const held = queue.policy === undefined ? undefined : await heldPolicyOf(sqs, url);
  const Attributes = withPolicy(queue, held);
  await sqs.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes }));
  await tagQueue(sqs, url, queue.tags);
  if (queue.untagged.length > 0) {
    await sqs.send(new UntagQueueCommand({ QueueUrl: url, TagKeys: [...queue.untagged] }));
  }
}

/** The queue's attributes with the policy that follows from the one it holds, in the same request. */
function withPolicy(queue: QueueToApply, held: string | undefined): Record<string, string> {
  const policy = queue.policy;
  return policy === undefined
    ? { ...queue.attributes }
    : { ...queue.attributes, Policy: policy(held) };
}

async function heldPolicyOf(sqs: SQSClient, url: string): Promise<string | undefined> {
  const read = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['Policy'] }),
  );
  return read.Attributes?.['Policy'];
}
