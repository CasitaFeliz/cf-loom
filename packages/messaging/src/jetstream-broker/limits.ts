import { inspect } from 'node:util';
import { locationOf, problemOf } from '@cf-loom/contract/internal';
import { nanos } from '@nats-io/nats-core';
import { z } from 'zod';

/** A length of time as limits write it: a whole number from 1 and one unit, `500ms`, `30s`, `2m`, `1h` or `7d`. */
export type Duration = `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`;

/** A stream's settings cf-loom has no opinion on, which the organization chooses. */
export type StreamLimits = {
  /** Which Messages the stream keeps: until its limits drop them, while a durable consumer still has to read them, or until one acknowledges them. */
  readonly retention: 'limits' | 'interest' | 'workqueue';
  /** How long the stream keeps a Message. */
  readonly maxAge: Duration | 'unlimited';
  /** How long the stream drops a Message whose broker message id it already holds. */
  readonly duplicateWindow: Duration;
  /** On how many NATS servers the stream is kept. */
  readonly replicas: number;
  /** Whether the stream is kept on disk or in memory; NATS never changes it once the stream exists. */
  readonly storage: 'file' | 'memory';
};

/** A durable consumer's settings cf-loom has no opinion on, which the organization chooses. */
export type DurableConsumerLimits = {
  /** Where a new durable consumer starts reading its stream; NATS never changes it once the durable consumer exists. */
  readonly deliverPolicy: 'all' | 'new' | 'last' | 'last_per_subject';
  /** How long a delivery waits for its acknowledgement before it comes again, or one wait per delivery, the last repeating. */
  readonly ackWait: Duration | readonly Duration[];
  /** How many times a Message is delivered at most. */
  readonly maxDeliver: number | 'unlimited';
  /** How many deliveries may wait for an acknowledgement at once. */
  readonly maxAckPending: number | 'unlimited';
};

/** Every setting of the plan's streams and durable consumers, keyed by the names the plan prints, with defaults for whatever one does not set. */
export type BrokerLimits = {
  readonly streamDefaults?: Partial<StreamLimits> | undefined;
  readonly consumerDefaults?: Partial<DurableConsumerLimits> | undefined;
  readonly streams?: Readonly<Record<string, Partial<StreamLimits>>> | undefined;
  readonly consumers?: Readonly<Record<string, Partial<DurableConsumerLimits>>> | undefined;
};

const millisInUnit = new Map([
  ['ms', 1],
  ['s', 1_000],
  ['m', 60_000],
  ['h', 3_600_000],
  ['d', 86_400_000],
]);

/** The nanoseconds of a duration text, when NATS can count them exactly. */
function nanosOf(input: unknown): number | undefined {
  const match = typeof input === 'string' ? /^([1-9]\d*)(ms|s|m|h|d)$/.exec(input) : null;
  const [, count = '', unit = ''] = match ?? [];
  const millis = millisInUnit.get(unit);
  if (millis === undefined) {
    return undefined;
  }
  const value = nanos(Number(count) * millis);
  return Number.isSafeInteger(value) ? value : undefined;
}

function countOf(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 1 ? input : undefined;
}

function isNumber(value: number | undefined): value is number {
  return value !== undefined;
}

/** The nanoseconds of one duration text, or of each in a list, when there is at least one and NATS can count them all exactly. */
function nanosListOf(input: unknown): readonly [number, ...number[]] | undefined {
  const waits = (Array.isArray(input) ? input : [input]).map(nanosOf);
  const [first, ...later] = waits.filter(isNumber);
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

function choice<const Choice extends string>(...choices: readonly Choice[]) {
  const last = choices.at(-1);
  const expected = `one of ${choices.slice(0, -1).join(', ')} or ${last}`;
  return readAs(expected, (input) => choices.find((candidate) => candidate === input));
}

const durationText = 'a duration such as 500ms, 30s, 2m, 1h or 7d';
const notAnObject = { error: () => 'is not an object' };

const streamLimits = z.strictObject(
  {
    retention: choice('limits', 'interest', 'workqueue').exactOptional(),
    maxAge: readAs(`${durationText}, or 'unlimited'`, (input) =>
      input === 'unlimited' ? 0 : nanosOf(input),
    ).exactOptional(),
    duplicateWindow: readAs(durationText, nanosOf).exactOptional(),
    replicas: readAs('a whole number from 1', countOf).exactOptional(),
    storage: choice('file', 'memory').exactOptional(),
  },
  notAnObject,
);

const consumerLimits = z.strictObject(
  {
    deliverPolicy: choice('all', 'new', 'last', 'last_per_subject').exactOptional(),
    ackWait: readAs(`${durationText}, or a list of them`, nanosListOf).exactOptional(),
    maxDeliver: readAs("a whole number from 1, or 'unlimited'", (input) =>
      input === 'unlimited' ? -1 : countOf(input),
    ).exactOptional(),
    maxAckPending: readAs("a whole number from 1, or 'unlimited'", (input) =>
      input === 'unlimited' ? -1 : countOf(input),
    ).exactOptional(),
  },
  notAnObject,
);

const brokerLimits = z.strictObject(
  {
    streamDefaults: streamLimits.optional(),
    consumerDefaults: consumerLimits.optional(),
    streams: z.record(z.string(), streamLimits, notAnObject).optional(),
    consumers: z.record(z.string(), consumerLimits, notAnObject).optional(),
  },
  notAnObject,
);

/** A stream's limits as NATS counts them, each possibly unset. */
export type ReadStreamLimits = z.output<typeof streamLimits>;

/** A durable consumer's limits as NATS counts them, each possibly unset. */
export type ReadConsumerLimits = z.output<typeof consumerLimits>;

/** The limits a Service passed, every value in NATS's units. */
export type ReadBrokerLimits = z.output<typeof brokerLimits>;

/** The limits a Service passed, read, or one line for each place they break their shape. */
export type ReadLimits =
  | { readonly kind: 'read'; readonly limits: ReadBrokerLimits }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

/** Reads the limits a Service passed, which only a JSON file or untyped code can get wrong. */
export function readLimits(limits: unknown): ReadLimits {
  const parsed = brokerLimits.safeParse(limits);
  if (!parsed.success) {
    return { kind: 'refused', lines: parsed.error.issues.map(lineOf) };
  }
  return { kind: 'read', limits: parsed.data };
}

function lineOf(issue: z.core.$ZodIssue): string {
  const problem = problemOf([issue], 'BrokerLimits');
  return `${locationOf(['limits', ...problem.at])} ${problem.reason}`;
}
