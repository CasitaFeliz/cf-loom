import type { BrokerPlanDurableConsumer } from '@cf-loom/contract/internal';
import { z } from 'zod';
import {
  countOf,
  everySetOf,
  type KindLimits,
  millisecondsOf,
  oneOrListOf,
  readAs,
} from '../broker-limits/index.ts';
import type { SqsDurableConsumerLimits } from './limits.ts';
import { backoffTextOf, longestTagValue } from './tags.ts';

const secondsInDay = 86_400;
const longestVisibilityTimeout = 12 * 3_600 - 1;
const shortestRetention = 60;
const longestRetention = 14 * secondsInDay;
const mostDeliveries = 1_000;

/** The whole seconds of a duration text; undefined for a text that is no duration or not whole seconds. */
function secondsOf(input: unknown): number | undefined {
  const milliseconds = millisecondsOf(input);
  return milliseconds === undefined || milliseconds % 1_000n !== 0n
    ? undefined
    : Number(milliseconds / 1_000n);
}

/** Reads a duration text as whole seconds within a range, both ends included. */
function secondsBetween(least: number, most: number): (input: unknown) => number | undefined {
  return (input) => {
    const seconds = secondsOf(input);
    return seconds !== undefined && seconds >= least && seconds <= most ? seconds : undefined;
  };
}

/** The first ack wait in seconds, which is the queue's visibility timeout, and the waits after it as written, which are its backoff tag. */
type Waits = { readonly visibilityTimeout: number; readonly backoff: string | undefined };

type Wait = { readonly text: string; readonly seconds: number };

/** Reads one wait of a queue, a visibility timeout or an entry of its backoff, as whole seconds under 12 hours: the rule `ackWait` is written by. */
export const readVisibilityTimeout = secondsBetween(1, longestVisibilityTimeout);

function waitOf(input: unknown): Wait | undefined {
  const seconds = readVisibilityTimeout(input);
  return typeof input === 'string' && seconds !== undefined ? { text: input, seconds } : undefined;
}

function waitsOf(input: unknown): Waits | undefined {
  const [first, ...later] = oneOrListOf(waitOf)(input) ?? [];
  if (first === undefined) {
    return undefined;
  }
  const backoff = later.length === 0 ? undefined : backoffTextOf(later.map(({ text }) => text));
  const isTooLong = backoff !== undefined && backoff.length > longestTagValue;
  return isTooLong ? undefined : { visibilityTimeout: first.seconds, backoff };
}

/** Reads a redrive's `maxReceiveCount`, a whole number from 1 to the most SQS accepts: the rule `maxDeliver` is written by. */
export function deliveriesOf(input: unknown): number | undefined {
  const count = countOf(input);
  return count !== undefined && count <= mostDeliveries ? count : undefined;
}

const waitsText = `a duration of whole seconds under 12h such as 30s or 5m, or a list of them whose entries after the first take at most ${longestTagValue} characters, joined by a space`;
const retentionText = 'a duration of whole seconds from 1m to 14d';
const readRetention = secondsBetween(shortestRetention, longestRetention);

/** The readers of a Durable consumer's settings, which read each in SQS's units. */
export const durableConsumerReaders = {
  ackWait: readAs(waitsText, waitsOf),
  maxDeliver: readAs(`a whole number from 1 to ${mostDeliveries}`, deliveriesOf),
  retention: readAs(retentionText, readRetention),
  deadLetterRetention: readAs(retentionText, readRetention),
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
