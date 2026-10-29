// biome-ignore-all lint/style/useNamingConvention: SQS spells its attributes in PascalCase
import { GetTopicAttributesCommand, type SNSClient } from '@aws-sdk/client-sns';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { type Applied, isAwsError, refusedBy } from './applied.ts';
import { type Place, queueArnOf, topicArnOf } from './connecting.ts';
import { applyQueue, tagQueue } from './queue-applying.ts';
import { deadLetterQueueNameOf, queueNameOf } from './queue-names.ts';
import { queuePolicyWith, type TopicSender } from './queue-policy.ts';
import type { PlannedQueue } from './reading-limits.ts';
import type { Subscribing } from './subscribing.ts';
import { subscriptionShapeOf } from './subscription-shape.ts';
import { backoffTag, deadLetterQueueTagsOf, queueTagsOf, subscriptionTag } from './tags.ts';

/** What applying works with: the SNS and SQS clients, where the environment's topics and queues are, and the subscriptions made so far. */
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
  const queueArn = queueArnOf(place, queueNameOf(planned.name));
  const topicArn = topicArnOf(place, planned.stream);
  if (!(await isTopic(sns, topicArn))) {
    const reads = `reads the stream ${planned.stream}, whose topic ${topicArn} does not exist yet`;
    const remedy = "apply its Service's plan first";
    return { kind: 'refused', message: `The Durable consumer ${planned.name} ${reads}: ${remedy}` };
  }
  await applyDeadLetterQueue(sqs, planned);
  const url = await applyMainQueue(applier, planned, { queueArn, topicArn });
  const shape = subscriptionShapeOf({ topicArn, queueArn, subject: planned.subject });
  const subscription = await applier.subscribing.subscribe(shape);
  await tagQueue(sqs, url, { [subscriptionTag]: subscription });
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

async function applyDeadLetterQueue(sqs: SQSClient, planned: PlannedQueue): Promise<void> {
  await applyQueue(sqs, {
    name: deadLetterQueueNameOf(planned.name),
    attributes: { MessageRetentionPeriod: String(planned.deadLetterRetention) },
    tags: deadLetterQueueTagsOf(planned),
    untagged: [],
  });
}

async function applyMainQueue(
  { sqs, place }: Applier,
  planned: PlannedQueue,
  sender: TopicSender,
): Promise<string> {
  const redrive = {
    deadLetterTargetArn: queueArnOf(place, deadLetterQueueNameOf(planned.name)),
    maxReceiveCount: planned.maxDeliver,
  };
  return await applyQueue(sqs, {
    name: queueNameOf(planned.name),
    attributes: {
      VisibilityTimeout: String(planned.visibilityTimeout),
      MessageRetentionPeriod: String(planned.retention),
      RedrivePolicy: JSON.stringify(redrive),
    },
    tags: queueTagsOf(planned),
    untagged: planned.backoff === undefined ? [backoffTag] : [],
    policy: (held) => queuePolicyWith(held, sender),
  });
}
