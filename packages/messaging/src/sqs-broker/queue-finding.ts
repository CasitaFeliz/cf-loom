// biome-ignore-all lint/style/useNamingConvention: SQS spells its fields in PascalCase
import { GetSubscriptionAttributesCommand, type SNSClient } from '@aws-sdk/client-sns';
import {
  GetQueueAttributesCommand,
  ListQueueTagsCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { prefixedNameOf, prefixedSubjectOf } from '@cf-loom/contract/internal';
import { type DurableConsumer, shapeRefusalOf } from '../broker/index.ts';
import { oneLineOf } from '../broker-limits/index.ts';
import { answeredWith, isAwsError } from './aws-errors.ts';
import { arnMismatchOf, queueArnOf, topicArnOf } from './connecting.ts';
import { queueNameOf } from './queue-names.ts';
import { type QueueHeld, queueReadingOf } from './queue-reading.ts';
import { queueUrlOf } from './queue-url.ts';
import type { Working } from './sqs-connection.ts';
import {
  type SubscriptionShape,
  subscriptionDifferencesWithIdentityOf,
  subscriptionShapeOf,
} from './subscription-shape.ts';
import { subscriptionTag } from './tags.ts';

/** A Durable consumer's queue as `consume` found it: where it is, the waits of its first deliveries in milliseconds and the receives its redrive allows. */
export type FoundQueue = {
  readonly durableConsumer: DurableConsumer;
  readonly durable: string;
  readonly name: string;
  readonly url: string;
  readonly waits: readonly [number, ...number[]];
  readonly maxReceiveCount: number;
};

/** Every Durable consumer's queue found, or a line for each one that is missing or not as the Broker plan makes it. */
export type Found =
  | { readonly kind: 'found'; readonly queues: readonly FoundQueue[] }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

/** Asks SQS for the queue of each Durable consumer under its prefixed name, every one before any is received from. */
export async function queuesFoundOf(
  working: Working,
  durableConsumers: readonly DurableConsumer[],
): Promise<Found> {
  const queues: FoundQueue[] = [];
  const lines: string[] = [];
  for (const durableConsumer of durableConsumers) {
    const finding = await queueFoundOf(working, durableConsumer);
    if (finding.kind === 'found') {
      queues.push(finding.queue);
    } else {
      lines.push(finding.line);
    }
  }
  return lines.length > 0 ? { kind: 'refused', lines } : { kind: 'found', queues };
}

type Finding =
  | { readonly kind: 'found'; readonly queue: FoundQueue }
  | { readonly kind: 'refused'; readonly line: string };

async function queueFoundOf(working: Working, durableConsumer: DurableConsumer): Promise<Finding> {
  const { sqs, sns, prefix, place } = working;
  const durable = prefixedNameOf(prefix, durableConsumer.durable);
  const name = queueNameOf(durable);
  const url = await queueUrlOf(sqs, name);
  if (url === undefined) {
    return refusedFor(`The Durable consumer ${durable}`, [`has no queue ${name}`]);
  }
  const held = await heldBy(sqs, url);
  const reading = queueReadingOf(held);
  const queueArn = queueArnOf(place, name);
  const shape = subscriptionShapeOf({
    topicArn: topicArnOf(place, prefixedNameOf(prefix, durableConsumer.stream)),
    queueArn,
    subject: prefixedSubjectOf(prefix, durableConsumer.subject),
  });
  const subscribed = await subscriptionDifferencesFor(sns, reading.subscriptionArn, shape);
  const differences = [...reading.differences, ...arnDifferencesOf(held, queueArn), ...subscribed];
  if (differences.length > 0 || reading.read === undefined) {
    return refusedFor(`The queue ${name} of the Durable consumer ${durable}`, differences);
  }
  const { waits, maxReceiveCount } = reading.read;
  return { kind: 'found', queue: { durableConsumer, durable, name, url, waits, maxReceiveCount } };
}

function refusedFor(what: string, differences: readonly string[]): Finding {
  return { kind: 'refused', line: shapeRefusalOf(what, differences) };
}

/** The attributes of the queue that cf-loom reads, and its tags. */
async function heldBy(sqs: SQSClient, url: string): Promise<QueueHeld> {
  const attributes = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: url,
      AttributeNames: ['VisibilityTimeout', 'RedrivePolicy', 'QueueArn'],
    }),
  );
  const tags = await sqs.send(new ListQueueTagsCommand({ QueueUrl: url }));
  return { attributes: attributes.Attributes ?? {}, tags: tags.Tags ?? {} };
}

/** That the queue's own ARN is not the one built, which a client of another account or region makes it. */
function arnDifferencesOf({ attributes }: QueueHeld, built: string): readonly string[] {
  const arn = answeredWith(attributes['QueueArn'], 'QueueArn');
  const mismatch = arnMismatchOf({ from: 'GetQueueAttributes', arn }, built);
  return mismatch === undefined ? [] : [`has a QueueArn other than the one built: ${mismatch}`];
}

/** How the subscription the queue is tagged with differs from the shape, or that the tag names none; any other error is thrown. */
async function subscriptionDifferencesFor(
  sns: SNSClient,
  arn: string | undefined,
  shape: SubscriptionShape,
): Promise<readonly string[]> {
  if (arn === undefined) {
    return [];
  }
  try {
    const read = await sns.send(new GetSubscriptionAttributesCommand({ SubscriptionArn: arn }));
    return subscriptionDifferencesWithIdentityOf(read.Attributes ?? {}, shape).map(
      (text) => `its subscription ${text}`,
    );
  } catch (error) {
    if (isAwsError(error, 'NotFoundException') || isAwsError(error, 'InvalidParameterException')) {
      return [`has the ${subscriptionTag} tag ${oneLineOf(arn)}, which names no subscription`];
    }
    throw error;
  }
}
