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
import { confirmArn } from './connecting.ts';

/** A queue or dead-letter queue as the plan wants it: the ARN its name has in the place of the clients, its attributes and tags, the tags it must not carry, and, for a queue that has one, how its policy follows from the policy it holds. */
export type QueueToApply = {
  readonly name: string;
  readonly arn: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly tags: Readonly<Record<string, string>>;
  readonly untagged: readonly string[];
  readonly policy?: (held: string | undefined) => string;
};

/** A queue that exists: its URL, and its ARN, which SQS gave it as built. */
export type AppliedQueue = { readonly url: string; readonly arn: string };

/** Creates the queue with everything it needs at once, or sets the attributes and tags of the one that exists and keeps every other attribute and tag; either way SQS must give it the ARN built, which a wrong account or region does not. */
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

/** Creates the queue with its attributes, policy and tags in one request, since SQS takes up to a minute to propagate an attribute set afterwards. */
async function create(sqs: SQSClient, queue: QueueToApply): Promise<AppliedQueue> {
  const Attributes = withPolicy(queue, undefined);
  const created = await sqs.send(
    new CreateQueueCommand({ QueueName: queue.name, Attributes, tags: { ...queue.tags } }),
  );
  const url = answeredWith(created.QueueUrl, 'QueueUrl');
  confirmQueueArn(queue, (await heldOf(sqs, url)).arn);
  return { url, arn: queue.arn };
}

async function update(sqs: SQSClient, url: string, queue: QueueToApply): Promise<AppliedQueue> {
  const held = await heldOf(sqs, url);
  confirmQueueArn(queue, held.arn);
  const Attributes = withPolicy(queue, held.policy);
  await sqs.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes }));
  await tagQueue(sqs, url, queue.tags);
  if (queue.untagged.length > 0) {
    await sqs.send(new UntagQueueCommand({ QueueUrl: url, TagKeys: [...queue.untagged] }));
  }
  return { url, arn: queue.arn };
}

type Held = { readonly arn: string; readonly policy: string | undefined };

async function heldOf(sqs: SQSClient, url: string): Promise<Held> {
  const read = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn', 'Policy'] }),
  );
  const attributes = read.Attributes ?? {};
  return { arn: answeredWith(attributes['QueueArn'], 'QueueArn'), policy: attributes['Policy'] };
}

/** Refuses a queue whose ARN SQS gives otherwise than built, since its policy, its redrive target and its subscription name the one built. */
function confirmQueueArn(queue: QueueToApply, arn: string): void {
  confirmArn({ from: `GetQueueAttributes of ${queue.name}`, arn }, queue.arn);
}

/** The queue's attributes with the policy that follows from the one it holds, in the same request. */
function withPolicy(queue: QueueToApply, heldPolicy: string | undefined): Record<string, string> {
  const policy = queue.policy;
  return policy === undefined
    ? { ...queue.attributes }
    : { ...queue.attributes, Policy: policy(heldPolicy) };
}
