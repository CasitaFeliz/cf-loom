// biome-ignore-all lint/style/useNamingConvention: SQS spells its attributes in PascalCase
import { GetTopicAttributesCommand, type SNSClient } from '@aws-sdk/client-sns';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { type Applied, refusedBy } from '../broker-applying/index.ts';
import { isAwsError } from './aws-errors.ts';
import { type Place, topicArnOf } from './connecting.ts';
import { type AppliedQueue, applyQueue, tagQueue } from './queue-applying.ts';
import { deadLetterQueueNameOf, queueNameOf } from './queue-names.ts';
import { queuePolicyWith } from './queue-policy.ts';
import type { PlannedQueue } from './reading-limits.ts';
import type { Subscribing } from './subscribing.ts';
import { subscriptionShapeOf } from './subscription-shape.ts';
import { backoffTag, deadLetterQueueTagsOf, queueTagsOf, subscriptionTag } from './tags.ts';

/** What applying works with: the SNS and SQS clients, where the environment's topics are, and the subscriptions made so far. */
export type Applier = {
  readonly sns: SNSClient;
  readonly sqs: SQSClient;
  readonly place: Place;
  readonly subscribing: Subscribing;
};

/** Creates the Durable consumer's dead-letter queue and queue, or updates the ones that exist, and subscribes the queue to its Stream's topic. */
export async function applyDurableConsumer(
  applier: Applier,
  planned: PlannedQueue,
): Promise<Applied> {
  try {
    return await createOrUpdate(applier, planned);
  } catch (error) {
    return refusedBy(`The Durable consumer ${planned.name}`, error);
  }
}

async function createOrUpdate(applier: Applier, planned: PlannedQueue): Promise<Applied> {
  const { sns, sqs, place } = applier;
  const topicArn = topicArnOf(place, planned.stream);
  if (!(await isTopic(sns, topicArn))) {
    const reads = `reads the stream ${planned.stream}, whose topic ${topicArn} does not exist yet`;
    const remedy = "apply its Service's plan first";
    return { kind: 'refused', message: `The Durable consumer ${planned.name} ${reads}: ${remedy}` };
  }
  const deadLetterQueue = await applyDeadLetterQueue(sqs, planned);
  const queue = await applyMainQueue(sqs, planned, { deadLetterQueue, topicArn });
  const queueOnTopic = { topicArn, queueArn: queue.arn, subject: planned.subject };
  const subscription = await applier.subscribing.subscribe(subscriptionShapeOf(queueOnTopic));
  await tagQueue(sqs, queue.url, { [subscriptionTag]: subscription });
  return { kind: 'applied' };
}

async function isTopic(sns: SNSClient, topicArn: string): Promise<boolean> {
  try {
    await sns.send(new GetTopicAttributesCommand({ TopicArn: topicArn }));
    return true;
  } catch (error) {
    if (isAwsError(error, 'NotFoundException')) {
      return false;
    }
    throw error;
  }
}

function applyDeadLetterQueue(sqs: SQSClient, planned: PlannedQueue): Promise<AppliedQueue> {
  return applyQueue(sqs, {
    name: deadLetterQueueNameOf(planned.name),
    attributes: { MessageRetentionPeriod: String(planned.deadLetterRetention) },
    tags: deadLetterQueueTagsOf(planned),
    untagged: [],
  });
}

/** Where the queue's Messages go when they are delivered too often, and the topic that may send to it. */
type Around = { readonly deadLetterQueue: AppliedQueue; readonly topicArn: string };

function applyMainQueue(
  sqs: SQSClient,
  planned: PlannedQueue,
  { deadLetterQueue, topicArn }: Around,
): Promise<AppliedQueue> {
  const redrive = { deadLetterTargetArn: deadLetterQueue.arn, maxReceiveCount: planned.maxDeliver };
  return applyQueue(sqs, {
    name: queueNameOf(planned.name),
    attributes: {
      VisibilityTimeout: String(planned.visibilityTimeout),
      MessageRetentionPeriod: String(planned.retention),
      RedrivePolicy: JSON.stringify(redrive),
    },
    tags: queueTagsOf(planned),
    untagged: planned.backoff === undefined ? [backoffTag] : [],
    policy: (held, queueArn) => queuePolicyWith(held, { queueArn, topicArn }),
  });
}
