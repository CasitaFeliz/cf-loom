// biome-ignore-all lint/style/useNamingConvention: SQS spells its attributes in PascalCase
import type { SNSClient } from '@aws-sdk/client-sns';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { type Applied, refusedBy } from '../broker-applying/index.ts';
import { type Place, queueArnOf, topicArnOf } from './connecting.ts';
import { type AppliedQueue, applyQueue, tagQueue } from './queue-applying.ts';
import { deadLetterQueueNameOf, queueNameOf } from './queue-names.ts';
import { queuePolicyWith } from './queue-policy.ts';
import type { PlannedQueue } from './reading-limits.ts';
import type { Subscribing } from './subscribing.ts';
import { subscriptionShapeOf } from './subscription-shape.ts';
import { backoffTag, deadLetterQueueTagsOf, queueTagsOf, subscriptionTag } from './tags.ts';
import { isTopic } from './topic-exists.ts';

/** What applying works with: the SNS and SQS clients, their place, and the subscriptions made so far. */
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
  const { sns, sqs } = applier;
  const topicArn = topicArnOf(applier.place, planned.stream);
  if (!(await isTopic(sns, topicArn))) {
    const reads = `reads the stream ${planned.stream}, whose topic ${topicArn} does not exist yet`;
    const remedy = "apply its Service's plan first";
    return { kind: 'refused', message: `The Durable consumer ${planned.name} ${reads}: ${remedy}` };
  }
  const deadLetterQueue = await applyDeadLetterQueue(applier, planned);
  const queue = await applyMainQueue(applier, planned, { deadLetterQueue, topicArn });
  const queueOnTopic = { topicArn, queueArn: queue.arn, subject: planned.subject };
  const subscription = await applier.subscribing.subscribe(subscriptionShapeOf(queueOnTopic));
  await tagQueue(sqs, queue.url, { [subscriptionTag]: subscription });
  return { kind: 'applied' };
}

function applyDeadLetterQueue(
  { sqs, place }: Applier,
  planned: PlannedQueue,
): Promise<AppliedQueue> {
  const name = deadLetterQueueNameOf(planned.name);
  return applyQueue(sqs, {
    name,
    arn: queueArnOf(place, name),
    attributes: { MessageRetentionPeriod: String(planned.deadLetterRetention) },
    tags: deadLetterQueueTagsOf(planned),
    untagged: [],
  });
}

/** Where the queue's Messages go when they are delivered too often, and the topic that may send to it. */
type Around = { readonly deadLetterQueue: AppliedQueue; readonly topicArn: string };

function applyMainQueue(
  { sqs, place }: Applier,
  planned: PlannedQueue,
  { deadLetterQueue, topicArn }: Around,
): Promise<AppliedQueue> {
  const redrive = { deadLetterTargetArn: deadLetterQueue.arn, maxReceiveCount: planned.maxDeliver };
  const name = queueNameOf(planned.name);
  const arn = queueArnOf(place, name);
  return applyQueue(sqs, {
    name,
    arn,
    attributes: {
      VisibilityTimeout: String(planned.visibilityTimeout),
      MessageRetentionPeriod: String(planned.retention),
      RedrivePolicy: JSON.stringify(redrive),
    },
    tags: queueTagsOf(planned),
    untagged: planned.backoff === undefined ? [backoffTag] : [],
    policy: (held) => queuePolicyWith(held, { queueArn: arn, topicArn }),
  });
}
