// biome-ignore-all lint/style/useNamingConvention: SQS spells its fields in PascalCase
import { GetSubscriptionAttributesCommand, type SNSClient } from '@aws-sdk/client-sns';
import {
  GetQueueAttributesCommand,
  ListQueueTagsCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { prefixedNameOf, prefixedSubjectOf } from '@cf-loom/contract/internal';
import { type DeliveryWaits, type DurableConsumer, shapeRefusalOf } from '../broker/index.ts';
import { oneLineOf } from '../broker-limits/index.ts';
import { answeredWith, isAwsError } from './aws-errors.ts';
import { arnMismatchOf, queueArnOf, type SqsSide, topicArnOf } from './connecting.ts';
import { queueNameOf } from './queue-names.ts';
import { type QueueHeld, type QueueReading, queueReadingOf } from './queue-reading.ts';
import { queueUrlOf } from './queue-url.ts';
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
  readonly waits: DeliveryWaits;
  readonly maxReceiveCount: number;
};

/** Every Durable consumer's queue found, or a line for each one that is missing or not as the Broker plan makes it. */
export type Found =
  | { readonly kind: 'found'; readonly queues: readonly FoundQueue[] }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

/** Asks SQS for the queue of each Durable consumer under its prefixed name, every one before any is received from. */
export async function queuesFoundOf(
  side: SqsSide,
  durableConsumers: readonly DurableConsumer[],
): Promise<Found> {
  const queues: FoundQueue[] = [];
  const lines: string[] = [];
  for (const durableConsumer of durableConsumers) {
    const finding = await queueFoundOf(side, durableConsumer);
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

async function queueFoundOf(side: SqsSide, durableConsumer: DurableConsumer): Promise<Finding> {
  const { sqs, prefix } = side;
  const durable = prefixedNameOf(prefix, durableConsumer.durable);
  const name = queueNameOf(durable);
  const url = await queueUrlOf(sqs, name);
  if (url === undefined) {
    return refusedFor(`The Durable consumer ${durable}`, [`has no queue ${name}`]);
  }
  const held = await heldBy(sqs, url);
  const reading = queueReadingOf(held);
  const further = await furtherDifferencesOf(side, { durableConsumer, name, held }, reading);
  const what = `The queue ${name} of the Durable consumer ${durable}`;
  if (reading.kind === 'differs') {
    return refusedFor(what, [...reading.differences, ...further]);
  }
  if (further.length > 0) {
    return refusedFor(what, further);
  }
  const { waits, maxReceiveCount } = reading;
  return { kind: 'found', queue: { durableConsumer, durable, name, url, waits, maxReceiveCount } };
}

/** What the queue's own ARN and the subscription its tag names add to the queue's differences. */
async function furtherDifferencesOf(
  { sns, prefix, place }: SqsSide,
  queue: {
    readonly durableConsumer: DurableConsumer;
    readonly name: string;
    readonly held: QueueHeld;
  },
  { subscriptionArn }: QueueReading,
): Promise<readonly string[]> {
  const { durableConsumer, name, held } = queue;
  const queueArn = queueArnOf(place, name);
  const shape = subscriptionShapeOf({
    topicArn: topicArnOf(place, prefixedNameOf(prefix, durableConsumer.stream)),
    queueArn,
    subject: prefixedSubjectOf(prefix, durableConsumer.subject),
  });
  const subscribed = await subscriptionDifferencesFor(sns, subscriptionArn, shape);
  return [...arnDifferencesOf(held, queueArn), ...subscribed];
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
