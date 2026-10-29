import type { BrokerPlanDurableConsumer } from '@cf-loom/contract/internal';
import { z } from 'zod';
import {
  countOf,
  durationText,
  everySetOf,
  type KindLimits,
  millisecondsOf,
  oneOrListOf,
  readAs,
} from '../broker-limits/index.ts';
import type { SqsDurableConsumerLimits } from './limits.ts';
import { backoffTextOf } from './tags.ts';

/** The whole seconds of a duration text. */
function secondsOf(input: unknown): number | undefined {
  const milliseconds = millisecondsOf(input);
  return milliseconds === undefined ? undefined : Number(milliseconds / 1_000n);
}

/** The first ack wait in seconds, which is the queue's visibility timeout, and the waits after it as written, which are its backoff tag. */
type Waits = { readonly visibilityTimeout: number; readonly backoff: string | undefined };

type Wait = { readonly text: string; readonly seconds: number };

function waitOf(input: unknown): Wait | undefined {
  const seconds = secondsOf(input);
  return typeof input === 'string' && seconds !== undefined ? { text: input, seconds } : undefined;
}

function waitsOf(input: unknown): Waits | undefined {
  const [first, ...later] = oneOrListOf(waitOf)(input) ?? [];
  if (first === undefined) {
    return undefined;
  }
  const backoff = later.length === 0 ? undefined : backoffTextOf(later.map(({ text }) => text));
  return { visibilityTimeout: first.seconds, backoff };
}

/** The readers of a Durable consumer's settings, which read each in SQS's units. */
export const durableConsumerReaders = {
  ackWait: readAs(`${durationText}, or a list of them`, waitsOf),
  maxDeliver: readAs('a whole number from 1', countOf),
  retention: readAs(durationText, secondsOf),
  deadLetterRetention: readAs(durationText, secondsOf),
} satisfies Record<keyof SqsDurableConsumerLimits, z.ZodType>;

/** The name of each setting of a Durable consumer's limits. */
const durableConsumerSettingNames = z.strictObject(durableConsumerReaders).keyof().options;

/** A Durable consumer of the plan with the SQS settings its limits resolve to. */
export type PlannedQueue = {
  readonly name: string;
  readonly stream: string;
  readonly service: string;
  readonly subject: string;
  readonly visibilityTimeout: number;
  readonly backoff: string | undefined;
  readonly retention: number;
  readonly deadLetterRetention: number;
  readonly maxDeliver: number;
};

/** How the plan's Durable consumers resolve to queues. */
export const durableConsumerLimits: KindLimits<
  typeof durableConsumerReaders,
  BrokerPlanDurableConsumer,
  PlannedQueue
> = {
  readers: durableConsumerReaders,
  resolve: (name, listed, limits) => {
    const set = everySetOf(limits, durableConsumerSettingNames);
    if (set.kind === 'unset') {
      return set;
    }
    const { ackWait, maxDeliver, retention, deadLetterRetention } = set.limits;
    const { stream, service, subject } = listed;
    const { visibilityTimeout, backoff } = ackWait;
    const planned = {
      ...{ name, stream, service, subject },
      ...{ visibilityTimeout, backoff, retention, deadLetterRetention, maxDeliver },
    };
    return { kind: 'planned', planned };
  },
};
