import { inspect } from 'node:util';
import { type Problem, problemLineOf, readWith } from '@cf-loom/contract/internal';
import { z } from 'zod';
import {
  type DurableConsumerLimits,
  deliverPolicies,
  retentions,
  type StreamLimits,
  storages,
} from './limits.ts';

const nanosInUnit = new Map([
  ['ms', 1_000_000n],
  ['s', 1_000_000_000n],
  ['m', 60_000_000_000n],
  ['h', 3_600_000_000_000n],
  ['d', 86_400_000_000_000n],
]);

const int64Max = 2n ** 63n - 1n;

/** The nanoseconds of a duration text, when NATS can hold them in 64 bits and a number exactly. */
function nanosOf(input: unknown): number | undefined {
  const match = typeof input === 'string' ? /^([1-9]\d*)(ms|s|m|h|d)$/.exec(input) : null;
  const [, count = '', unit = ''] = match ?? [];
  const unitNanos = nanosInUnit.get(unit);
  if (unitNanos === undefined) {
    return undefined;
  }
  const exact = BigInt(count) * unitNanos;
  return exact <= int64Max && BigInt(Number(exact)) === exact ? Number(exact) : undefined;
}

function countOf(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 1 ? input : undefined;
}

function isCounted(value: number | undefined): value is number {
  return value !== undefined;
}

/** The nanoseconds of one duration text, or of each in a list, when there is at least one and NATS can hold them all. */
function nanosListOf(input: unknown): readonly [number, ...number[]] | undefined {
  const waits = (Array.isArray(input) ? input : [input]).map(nanosOf);
  const [first, ...later] = waits.filter(isCounted);
  const isEveryWaitCounted = first !== undefined && later.length + 1 === waits.length;
  return isEveryWaitCounted ? [first, ...later] : undefined;
}

/** A value read by `read`, which answers undefined for what it refuses, as an issue that shows the value. */
function readAs<Value>(expected: string, read: (input: unknown) => Value | undefined) {
  return z.unknown().transform((input, context) => {
    const value = read(input);
    if (value === undefined) {
      const message = `${inspect(input, { breakLength: Infinity })} is not ${expected}`;
      context.issues.push({ code: 'custom', message, input });
      return z.NEVER;
    }
    return value;
  });
}

function choice<const Choice extends string>(choices: readonly Choice[]) {
  const expected = `one of ${choices.slice(0, -1).join(', ')} or ${choices.at(-1)}`;
  return readAs(expected, (input) => choices.find((candidate) => candidate === input));
}

const durationText = 'a duration such as 500ms, 30s, 2m, 1h or 7d';
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

const durableShape = {
  deliverPolicy: choice(deliverPolicies).optional(),
  ackWait: readAs(`${durationText}, or a list of them`, nanosListOf).optional(),
  maxDeliver: unlimitedCount.optional(),
  maxAckPending: unlimitedCount.optional(),
} satisfies Record<keyof DurableConsumerLimits, z.ZodType>;

const streamLimits = z.strictObject(streamShape);
const durableLimits = z.strictObject(durableShape);

/** The name of each setting of a stream's limits. */
export const streamSettingNames = streamLimits.keyof().options;

/** The name of each setting of a durable consumer's limits. */
export const durableSettingNames = durableLimits.keyof().options;

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
const definedDurableLimits = durableLimits.transform((limits) =>
  definedOf(durableSettingNames, limits),
);

const brokerLimits = z.strictObject({
  streamDefaults: definedStreamLimits.optional(),
  consumerDefaults: definedDurableLimits.optional(),
  streams: z.record(z.string(), definedStreamLimits.optional()).transform(entriesOf).optional(),
  consumers: z.record(z.string(), definedDurableLimits.optional()).transform(entriesOf).optional(),
});

/** A stream's limits as NATS counts them, each possibly unset. */
export type NatsStreamLimits = z.output<typeof streamLimits>;

/** A durable consumer's limits as NATS counts them, each possibly unset. */
export type NatsDurableLimits = z.output<typeof durableLimits>;

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
