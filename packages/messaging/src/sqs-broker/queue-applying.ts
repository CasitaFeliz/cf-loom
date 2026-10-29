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

/** A queue or dead-letter queue as the plan wants it: the ARN its name has in the place of the SQS client, its attributes and tags, the tags it must not carry, and, for a queue that has one, how its policy follows from the policy it holds and the queue's ARN. */
export type QueueToApply = {
  readonly name: string;
  readonly arn: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly tags: Readonly<Record<string, string>>;
  readonly untagged: readonly string[];
  readonly policy?: (held: string | undefined, queueArn: string) => string;
};

/** A queue that exists: its URL, and its ARN as SQS gives it. */
export type AppliedQueue = { readonly url: string; readonly arn: string };

/** Creates the queue with everything it needs at once, or sets the attributes and tags of the one that exists and keeps every other attribute and tag. */
export async function applyQueue(sqs: SQSClient, queue: QueueToApply): Promise<AppliedQueue> {
  const url = await urlOf(sqs, queue.name);
  return url === undefined ? await create(sqs, queue) : await update(sqs, url, queue);
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

/** Creates the queue with its attributes, policy and tags in one request, since SQS takes up to a minute to propagate an attribute set afterwards, then checks that its ARN is the one its policy names. */
async function create(sqs: SQSClient, queue: QueueToApply): Promise<AppliedQueue> {
  const Attributes = withPolicy(queue, undefined, queue.arn);
  const created = await sqs.send(
    new CreateQueueCommand({ QueueName: queue.name, Attributes, tags: { ...queue.tags } }),
  );
  const url = answeredWith(created.QueueUrl, 'QueueUrl');
  const { arn } = await heldOf(sqs, url);
  if (arn !== queue.arn) {
    const given = `SQS gave the queue ${queue.name} the ARN ${arn}, not ${queue.arn}`;
    throw new Error(`${given}: check connecting.account and the region of the SQS client`);
  }
  return { url, arn };
}

async function update(sqs: SQSClient, url: string, queue: QueueToApply): Promise<AppliedQueue> {
  const held = await heldOf(sqs, url);
  const Attributes = withPolicy(queue, held.policy, held.arn);
  await sqs.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes }));
  await tagQueue(sqs, url, queue.tags);
  if (queue.untagged.length > 0) {
    await sqs.send(new UntagQueueCommand({ QueueUrl: url, TagKeys: [...queue.untagged] }));
  }
  return { url, arn: held.arn };
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
function withPolicy(
  queue: QueueToApply,
  heldPolicy: string | undefined,
  queueArn: string,
): Record<string, string> {
  const policy = queue.policy;
  return policy === undefined
    ? { ...queue.attributes }
    : { ...queue.attributes, Policy: policy(heldPolicy, queueArn) };
}
