// biome-ignore-all lint/style/useNamingConvention: SQS spells its fields in PascalCase
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { prefixedNameOf } from '@cf-loom/contract/internal';
import type { DurableConsumer } from '../broker/index.ts';
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
  for (const durableConsumer of durableConsumers) {
    queues.push(await queueFoundOf(working, durableConsumer));
  }
  return { kind: 'found', queues };
}

async function queueFoundOf(
  { sqs, prefix }: Working,
  durableConsumer: DurableConsumer,
): Promise<FoundQueue> {
  const durable = prefixedNameOf(prefix, durableConsumer.durable);
  const name = queueNameOf(durable);
  const url = await queueUrlOf(sqs, name);
  if (url === undefined) {
    throw new Error(`The Durable consumer ${durable} has no queue ${name}`);
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
  return {
    durableConsumer,
    durable,
    name,
    url,
    waits: [visibilityTimeout * 1_000],
    maxReceiveCount: redrive.maxReceiveCount,
  };
}
