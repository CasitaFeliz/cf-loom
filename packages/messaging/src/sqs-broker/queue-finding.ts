// biome-ignore-all lint/style/useNamingConvention: SQS spells its fields in PascalCase
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { prefixedNameOf } from '@cf-loom/contract/internal';
import { type DurableConsumer, shapeRefusalOf } from '../broker/index.ts';
import { queueNameOf } from './queue-names.ts';
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

async function queueFoundOf(
  { sqs, prefix }: Working,
  durableConsumer: DurableConsumer,
): Promise<Finding> {
  const durable = prefixedNameOf(prefix, durableConsumer.durable);
  const name = queueNameOf(durable);
  const url = await queueUrlOf(sqs, name);
  if (url === undefined) {
    return {
      kind: 'refused',
      line: shapeRefusalOf(`The Durable consumer ${durable}`, [`has no queue ${name}`]),
    };
  }
  const read = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: url,
      AttributeNames: ['VisibilityTimeout', 'RedrivePolicy'],
    }),
  );
  const attributes = read.Attributes ?? {};
  const visibilityTimeout = Number(attributes['VisibilityTimeout']);
  const redrive = JSON.parse(attributes['RedrivePolicy'] ?? '{}');
  const queue = {
    durableConsumer,
    durable,
    name,
    url,
    waits: [visibilityTimeout * 1_000],
    maxReceiveCount: redrive.maxReceiveCount,
  } as const;
  return { kind: 'found', queue };
}
