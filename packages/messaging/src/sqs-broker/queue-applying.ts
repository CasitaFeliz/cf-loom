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
import { answeredWith, isAwsError } from './aws-errors.ts';

/** A queue or dead-letter queue as the plan wants it: its attributes and tags, the tags it must not carry, and, for a queue that has one, how its policy follows from the policy it holds and the queue's own ARN. */
export type QueueToApply = {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly tags: Readonly<Record<string, string>>;
  readonly untagged: readonly string[];
  readonly policy?: (held: string | undefined, queueArn: string) => string;
};

/** A queue that exists: its URL, and its ARN as SQS gives it. */
export type AppliedQueue = { readonly url: string; readonly arn: string };

/** Creates the queue if it does not exist, then sets its attributes and tags and keeps every other attribute and tag. */
export async function applyQueue(sqs: SQSClient, queue: QueueToApply): Promise<AppliedQueue> {
  const url = (await urlOf(sqs, queue.name)) ?? (await create(sqs, queue.name));
  const held = await heldOf(sqs, url);
  const Attributes = withPolicy(queue, held);
  await sqs.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes }));
  await tagQueue(sqs, url, queue.tags);
  if (queue.untagged.length > 0) {
    await sqs.send(new UntagQueueCommand({ QueueUrl: url, TagKeys: [...queue.untagged] }));
  }
  return { url, arn: held.arn };
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

async function create(sqs: SQSClient, name: string): Promise<string> {
  const created = await sqs.send(new CreateQueueCommand({ QueueName: name }));
  return answeredWith(created.QueueUrl, 'QueueUrl');
}

type Held = { readonly arn: string; readonly policy: string | undefined };

async function heldOf(sqs: SQSClient, url: string): Promise<Held> {
  const read = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn', 'Policy'] }),
  );
  const attributes = read.Attributes ?? {};
  return { arn: answeredWith(attributes['QueueArn'], 'QueueArn'), policy: attributes['Policy'] };
}

/** The queue's attributes with the policy that follows from the one it holds, in the same request. */
function withPolicy(queue: QueueToApply, held: Held): Record<string, string> {
  const policy = queue.policy;
  return policy === undefined
    ? { ...queue.attributes }
    : { ...queue.attributes, Policy: policy(held.policy, held.arn) };
}
