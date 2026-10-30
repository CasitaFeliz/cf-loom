// biome-ignore-all lint/style/useNamingConvention: SQS spells its fields in PascalCase
import {
  GetQueueAttributesCommand,
  ListQueueTagsCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { prefixedNameOf } from '@cf-loom/contract/internal';
import { type DurableConsumer, shapeRefusalOf } from '../broker/index.ts';
import { queueNameOf } from './queue-names.ts';
import { type QueueHeld, queueReadingOf } from './queue-reading.ts';
import { queueUrlOf } from './queue-url.ts';
import type { Working } from './sqs-connection.ts';

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
  const { sqs, prefix } = working;
  const durable = prefixedNameOf(prefix, durableConsumer.durable);
  const name = queueNameOf(durable);
  const url = await queueUrlOf(sqs, name);
  if (url === undefined) {
    return refusedFor(`The Durable consumer ${durable}`, [`has no queue ${name}`]);
  }
  const reading = queueReadingOf(await heldBy(sqs, url));
  if (reading.kind === 'differs') {
    return refusedFor(`The queue ${name} of the Durable consumer ${durable}`, reading.differences);
  }
  const { waits, maxReceiveCount } = reading;
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
      AttributeNames: ['VisibilityTimeout', 'RedrivePolicy'],
    }),
  );
  const tags = await sqs.send(new ListQueueTagsCommand({ QueueUrl: url }));
  return { attributes: attributes.Attributes ?? {}, tags: tags.Tags ?? {} };
}
