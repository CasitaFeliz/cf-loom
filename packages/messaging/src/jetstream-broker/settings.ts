import type { BrokerPlanDurableConsumer, BrokerPlanStream } from '@cf-loom/contract/internal';
import type { StreamConfig } from '@nats-io/jetstream';
import { everySetOf, type KindLimits, plannedOf } from '../broker-limits/index.ts';
import type { DurableConsumerSettings } from './durable-consumer-shape.ts';
import { durableConsumerConfigOf, streamConfigOf } from './nats-config.ts';
import {
  durableConsumerReaders,
  durableConsumerSettingNames,
  streamReaders,
  streamSettingNames,
} from './reading-limits.ts';

/** A stream of the plan with the NATS settings its limits resolve to. */
export type PlannedStream = {
  readonly name: string;
  readonly subjects: readonly string[];
  readonly settings: Partial<StreamConfig>;
};

/** A Durable consumer of the plan with the NATS settings its limits resolve to. */
export type PlannedDurableConsumer = {
  readonly name: string;
  readonly stream: string;
  readonly settings: DurableConsumerSettings;
};

/** Every stream and Durable consumer of a plan with its settings. */
export type ResolvedPlan = {
  readonly streams: readonly PlannedStream[];
  readonly durableConsumers: readonly PlannedDurableConsumer[];
};

const stream: KindLimits<typeof streamReaders, BrokerPlanStream, PlannedStream> = {
  readers: streamReaders,
  resolve: (name, listed, limits) => {
    const every = everySetOf(limits, streamSettingNames);
    if (every.kind === 'unset') {
      return every;
    }
    const settings = streamConfigOf(every.limits);
    return { kind: 'planned', planned: { name, subjects: listed.subjects, settings } };
  },
};

const durableConsumer: KindLimits<
  typeof durableConsumerReaders,
  BrokerPlanDurableConsumer,
  PlannedDurableConsumer
> = {
  readers: durableConsumerReaders,
  resolve: (name, listed, limits) => {
    const every = everySetOf(limits, durableConsumerSettingNames);
    if (every.kind === 'unset') {
      return every;
    }
    const settings = durableConsumerConfigOf({ name, subject: listed.subject }, every.limits);
    return { kind: 'planned', planned: { name, stream: listed.stream, settings } };
  },
};

/**
 * The settings of each stream and Durable consumer of the plan, from its own limits over the
 * defaults, in NATS's units; limits that break their shape, name what the plan does not list or
 * leave a setting unset are refused whole.
 */
export function checkedOf(plan: unknown, limits: unknown) {
  return plannedOf(plan, limits, { definer: 'BrokerLimits', stream, durableConsumer });
}
