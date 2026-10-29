import { z } from 'zod';
import {
  choice,
  countOf,
  durationText,
  millisecondsOf,
  oneOrListOf,
  type ReadOf,
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

/** The readers of a Stream's settings, which read each in NATS's units. */
export const streamReaders = {
  retention: choice(retentions),
  maxAge: readAs(`${durationText}, or 'unlimited'`, (input) =>
    input === 'unlimited' ? 0 : nanosOf(input),
  ),
  duplicateWindow: readAs(durationText, nanosOf),
  replicas: readAs('a whole number from 1', countOf),
  storage: choice(storages),
} satisfies Record<keyof StreamLimits, z.ZodType>;

/** The readers of a Durable consumer's settings, which read each in NATS's units. */
export const durableConsumerReaders = {
  deliverPolicy: choice(deliverPolicies),
  ackWait: readAs(`${durationText}, or a list of them`, oneOrListOf(nanosOf)),
  maxDeliver: unlimitedCount,
  maxAckPending: unlimitedCount,
} satisfies Record<keyof DurableConsumerLimits, z.ZodType>;

/** The name of each setting of a Stream's limits. */
export const streamSettingNames = z.strictObject(streamReaders).keyof().options;

/** The name of each setting of a Durable consumer's limits. */
export const durableConsumerSettingNames = z.strictObject(durableConsumerReaders).keyof().options;

/** A Stream's limits as NATS counts them, each possibly unset. */
export type NatsStreamLimits = ReadOf<typeof streamReaders>;

/** A Durable consumer's limits as NATS counts them, each possibly unset. */
export type NatsDurableConsumerLimits = ReadOf<typeof durableConsumerReaders>;
