import { z } from 'zod';
import type { DeliveryLimits, DurableConsumer } from '../broker/index.ts';
import {
  durationText,
  everySetOf,
  type KindLimits,
  millisecondsOf,
  oneOrListOf,
  readAs,
  unlimitedCount,
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

/** A Durable consumer `consume` was handed, with the limits its name resolves to. */
export type Resolved = {
  readonly durableConsumer: DurableConsumer;
  readonly limits: DeliveryLimits;
};

/** How the Durable consumers `consume` hands resolve to the limits each Delivery is made from. */
export const durableConsumerLimits: KindLimits<
  typeof durableConsumerReaders,
  DurableConsumer,
  Resolved
> = {
  readers: durableConsumerReaders,
  resolve: (_name, durableConsumer, limits) => {
    const set = everySetOf(limits, settingNames);
    if (set.kind === 'unset') {
      return set;
    }
    const { ackWait, maxDeliver } = set.limits;
    return {
      kind: 'planned',
      planned: { durableConsumer, limits: { waits: ackWait, maxDeliver } },
    };
  },
};
