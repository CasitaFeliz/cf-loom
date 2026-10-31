import { z } from 'zod';
import type { DeliveryLimits } from '../broker/index.ts';
import {
  durationText,
  everySetOf,
  millisecondsOf,
  oneOrListOf,
  type ReadOf,
  readAs,
  type Unset,
  unlimitedCount,
  unsetDurableConsumerLine,
} from '../broker-limits/index.ts';
import type { InProcessDurableConsumerLimits } from './limits.ts';

/** The milliseconds of a duration text, when a number holds them exactly. */
function exactMillisecondsOf(input: unknown): number | undefined {
  const milliseconds = millisecondsOf(input);
  if (milliseconds === undefined || milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }
  return Number(milliseconds);
}

/** The readers of a Durable consumer's settings, which read each in the process's units, milliseconds and counts. */
export const durableConsumerReaders = {
  ackWait: readAs(`${durationText}, or a list of them`, oneOrListOf(exactMillisecondsOf)),
  maxDeliver: unlimitedCount,
} satisfies Record<keyof InProcessDurableConsumerLimits, z.ZodType>;

const settingNames = z.strictObject(durableConsumerReaders).keyof().options;

type DurableConsumerSettings = ReadOf<typeof durableConsumerReaders>;

/** The limits as read: the defaults and each Durable consumer's own. */
export type ReadLimits = {
  readonly durableConsumerDefaults?: DurableConsumerSettings | undefined;
  readonly durableConsumers?: Readonly<Record<string, DurableConsumerSettings>> | undefined;
};

/** What a Durable consumer's own settings over the defaults resolve to, or the line naming what is unset. */
export type ResolvedLimits =
  | { readonly kind: 'resolved'; readonly limits: DeliveryLimits }
  | { readonly kind: 'unset'; readonly line: string };

/** Resolves one Durable consumer's limits by its name, as the Broker plan prints it. */
export function resolvedLimitsOf(read: ReadLimits, durable: string): ResolvedLimits {
  const limits = { ...read.durableConsumerDefaults, ...read.durableConsumers?.[durable] };
  const set = everySetOf(limits, settingNames);
  if (set.kind === 'unset') {
    const unset: Unset = { name: durable, names: set.names };
    return { kind: 'unset', line: unsetDurableConsumerLine(unset) };
  }
  const { ackWait, maxDeliver } = set.limits;
  return { kind: 'resolved', limits: { waits: ackWait, maxDeliver } };
}
