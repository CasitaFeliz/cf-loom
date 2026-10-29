import { type Problem, problemLineOf, readWith } from '@cf-loom/contract/internal';
import { z } from 'zod';
import {
  choice,
  countOf,
  durationText,
  millisecondsOf,
  oneOrListOf,
  readAs,
} from '../broker-limits/index.ts';
import {
  type DurableConsumerLimits,
  deliverPolicies,
  retentions,
  type StreamLimits,
  storages,
} from './limits.ts';

const nanosInMillisecond = 1_000_000n;

const int64Max = 2n ** 63n - 1n;

/** The nanoseconds of a duration text, when NATS can hold them in 64 bits and a number exactly. */
function nanosOf(input: unknown): number | undefined {
  const milliseconds = millisecondsOf(input);
  if (milliseconds === undefined) {
    return undefined;
  }
  const exact = milliseconds * nanosInMillisecond;
  return exact <= int64Max && BigInt(Number(exact)) === exact ? Number(exact) : undefined;
}

const unlimitedCount = readAs("a whole number from 1, or 'unlimited'", (input) =>
  input === 'unlimited' ? -1 : countOf(input),
);

const streamShape = {
  retention: choice(retentions).optional(),
  maxAge: readAs(`${durationText}, or 'unlimited'`, (input) =>
    input === 'unlimited' ? 0 : nanosOf(input),
  ).optional(),
  duplicateWindow: readAs(durationText, nanosOf).optional(),
  replicas: readAs('a whole number from 1', countOf).optional(),
  storage: choice(storages).optional(),
} satisfies Record<keyof StreamLimits, z.ZodType>;

const durableConsumerShape = {
  deliverPolicy: choice(deliverPolicies).optional(),
  ackWait: readAs(`${durationText}, or a list of them`, oneOrListOf(nanosOf)).optional(),
  maxDeliver: unlimitedCount.optional(),
  maxAckPending: unlimitedCount.optional(),
} satisfies Record<keyof DurableConsumerLimits, z.ZodType>;

const streamLimits = z.strictObject(streamShape);
const durableConsumerLimits = z.strictObject(durableConsumerShape);

/** The name of each setting of a stream's limits. */
export const streamSettingNames = streamLimits.keyof().options;

/** The name of each setting of a Durable consumer's limits. */
export const durableConsumerSettingNames = durableConsumerLimits.keyof().options;

/** The settings of limits that are not `undefined`, which leaves one unset like a missing key. */
function definedOf<Limits extends object>(
  names: readonly (keyof Limits)[],
  limits: Limits,
): Partial<Limits> {
  const defined: Partial<Limits> = {};
  for (const name of names) {
    const setting = limits[name];
    if (setting !== undefined) {
      defined[name] = setting;
    }
  }
  return defined;
}

function hasEntry<Entry>(pair: readonly [string, Entry | undefined]): pair is [string, Entry] {
  return pair[1] !== undefined;
}

/** A record of limits keyed by name, without the entries that are `undefined`. */
function entriesOf<Entry>(entries: Readonly<Record<string, Entry | undefined>>) {
  return Object.fromEntries(Object.entries(entries).filter(hasEntry));
}

const definedStreamLimits = streamLimits.transform((limits) =>
  definedOf(streamSettingNames, limits),
);
const definedDurableConsumerLimits = durableConsumerLimits.transform((limits) =>
  definedOf(durableConsumerSettingNames, limits),
);

const brokerLimits = z.strictObject({
  streamDefaults: definedStreamLimits.optional(),
  durableConsumerDefaults: definedDurableConsumerLimits.optional(),
  streams: z.record(z.string(), definedStreamLimits.optional()).transform(entriesOf).optional(),
  durableConsumers: z
    .record(z.string(), definedDurableConsumerLimits.optional())
    .transform(entriesOf)
    .optional(),
});

/** A stream's limits as NATS counts them, each possibly unset. */
export type NatsStreamLimits = z.output<typeof streamLimits>;

/** A Durable consumer's limits as NATS counts them, each possibly unset. */
export type NatsDurableConsumerLimits = z.output<typeof durableConsumerLimits>;

/** The limits a Service passed, every value in NATS's units. */
export type NatsBrokerLimits = z.output<typeof brokerLimits>;

/** Limits with every setting set. */
export type SetLimits<Limits> = {
  readonly [Name in keyof Limits]-?: Exclude<Limits[Name], undefined>;
};

/** The limits a Service passed, read, or one line for each place they break their shape. */
export type ReadLimits =
  | { readonly kind: 'read'; readonly limits: NatsBrokerLimits }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

/** Reads the limits a Service passed, which only a JSON file or untyped code can get wrong. */
export function readLimits(limits: unknown): ReadLimits {
  const read = readWith(brokerLimits, limits, 'BrokerLimits');
  if (read.kind === 'refused') {
    return { kind: 'refused', lines: read.problems.map(lineOf) };
  }
  return { kind: 'read', limits: read.value };
}

function lineOf(problem: Problem): string {
  return problemLineOf({ at: ['limits', ...problem.at], reason: problem.reason });
}
