// biome-ignore-all lint/style/useNamingConvention: SQS spells its attributes in PascalCase
import { type Applied, refusedBy } from './applied.ts';
import { type Place, queueArnOf, type SqsConnecting } from './connecting.ts';
import { applyQueue } from './queue-applying.ts';
import { deadLetterQueueNameOf, queueNameOf } from './queue-names.ts';
import type { PlannedQueue } from './reading-limits.ts';
import { backoffTag, deadLetterQueueTagsOf, queueTagsOf } from './tags.ts';

/** Creates the Durable consumer's dead-letter queue and queue, or updates the ones that exist. */
export async function applyDurableConsumer(
  connecting: Pick<SqsConnecting, 'sqs'>,
  place: Place,
  planned: PlannedQueue,
): Promise<Applied> {
  try {
    await createOrUpdate(connecting, place, planned);
    return { kind: 'applied' };
  } catch (error) {
    return refusedBy(`The Durable consumer ${planned.name}`, error);
  }
}

async function createOrUpdate(
  { sqs }: Pick<SqsConnecting, 'sqs'>,
  place: Place,
  planned: PlannedQueue,
): Promise<void> {
  const deadLetterName = deadLetterQueueNameOf(planned.name);
  await applyQueue(sqs, {
    name: deadLetterName,
    attributes: { MessageRetentionPeriod: String(planned.deadLetterRetention) },
    tags: deadLetterQueueTagsOf(planned),
    untagged: [],
  });
  const redrive = {
    deadLetterTargetArn: queueArnOf(place, deadLetterName),
    maxReceiveCount: planned.maxDeliver,
  };
  await applyQueue(sqs, {
    name: queueNameOf(planned.name),
    attributes: {
      VisibilityTimeout: String(planned.visibilityTimeout),
      MessageRetentionPeriod: String(planned.retention),
      RedrivePolicy: JSON.stringify(redrive),
    },
    tags: queueTagsOf(planned),
    untagged: planned.backoff === undefined ? [backoffTag] : [],
  });
}
