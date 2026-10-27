import type { BrokerPlan } from '@cf-loom/contract/internal';
import type { StreamConfig } from '@nats-io/jetstream';
import type { DurableConsumerSettings } from './durable-shape.ts';
import { durableConsumerConfigOf, streamConfigOf } from './nats-config.ts';
import {
  durableConsumerSettingNames,
  type NatsBrokerLimits,
  type NatsDurableConsumerLimits,
  type NatsStreamLimits,
  readLimits,
  type SetLimits,
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
  readonly kind: 'resolved';
  readonly streams: readonly PlannedStream[];
  readonly durableConsumers: readonly PlannedDurableConsumer[];
};

/** A plan with its settings, or a line for each reason the plan and its limits cannot be applied. */
export type PlanSettings =
  | ResolvedPlan
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

type Resolved<Planned> = { readonly planned: Planned[]; readonly lines: string[] };

/**
 * The settings of each stream and Durable consumer of the plan, from its own limits over the
 * defaults, in NATS's units; limits that break their shape, name what the plan does not list or
 * leave a setting unset are refused whole.
 */
export function settingsOf(plan: BrokerPlan, limits: unknown): PlanSettings {
  const read = readLimits(limits);
  if (read.kind === 'refused') {
    return read;
  }
  const streams = streamsOf(plan, read.limits);
  const durableConsumers = plannedDurableConsumersOf(plan, read.limits);
  const lines = [
    ...unlistedLinesOf(plan, read.limits),
    ...streams.lines,
    ...durableConsumers.lines,
  ];
  if (lines.length > 0) {
    return { kind: 'refused', lines };
  }
  return {
    kind: 'resolved',
    streams: streams.planned,
    durableConsumers: durableConsumers.planned,
  };
}

function unlistedLinesOf(plan: BrokerPlan, limits: NatsBrokerLimits): readonly string[] {
  const streams = unlistedNamesOf(plan.streams, limits.streams);
  const durableConsumers = unlistedNamesOf(plan.durableConsumers, limits.durableConsumers);
  return [
    ...streams.map((name) => `limits.streams names ${name}, which the plan does not list`),
    ...durableConsumers.map(
      (name) => `limits.durableConsumers names ${name}, which the plan does not list`,
    ),
  ];
}

/** The names limits holds an entry for that the plan does not list. */
function unlistedNamesOf(
  listed: Readonly<Record<string, unknown>>,
  entries: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  return Object.entries(entries ?? {})
    .filter(([name]) => !Object.hasOwn(listed, name))
    .map(([name]) => name);
}

function unsetNamesOf<Name extends string>(
  settings: Partial<Record<Name, unknown>>,
  names: readonly Name[],
): readonly Name[] {
  return names.filter((name) => settings[name] === undefined);
}

function isStreamSet(limits: NatsStreamLimits): limits is SetLimits<NatsStreamLimits> {
  return unsetNamesOf(limits, streamSettingNames).length === 0;
}

function isDurableConsumerSet(
  limits: NatsDurableConsumerLimits,
): limits is SetLimits<NatsDurableConsumerLimits> {
  return unsetNamesOf(limits, durableConsumerSettingNames).length === 0;
}

function streamsOf(plan: BrokerPlan, limits: NatsBrokerLimits): Resolved<PlannedStream> {
  const planned: PlannedStream[] = [];
  const lines: string[] = [];
  for (const [name, stream] of Object.entries(plan.streams)) {
    const streamLimits = { ...limits.streamDefaults, ...limits.streams?.[name] };
    if (isStreamSet(streamLimits)) {
      planned.push({ name, subjects: stream.subjects, settings: streamConfigOf(streamLimits) });
    } else {
      const unset = unsetNamesOf(streamLimits, streamSettingNames).join(', ');
      lines.push(`The stream ${name} has no ${unset} in limits.streams or limits.streamDefaults`);
    }
  }
  return { planned, lines };
}

function plannedDurableConsumersOf(
  plan: BrokerPlan,
  limits: NatsBrokerLimits,
): Resolved<PlannedDurableConsumer> {
  const planned: PlannedDurableConsumer[] = [];
  const lines: string[] = [];
  for (const [name, durableConsumer] of Object.entries(plan.durableConsumers)) {
    const durableConsumerLimits = {
      ...limits.durableConsumerDefaults,
      ...limits.durableConsumers?.[name],
    };
    if (isDurableConsumerSet(durableConsumerLimits)) {
      planned.push({
        name,
        stream: durableConsumer.stream,
        settings: durableConsumerConfigOf(
          { name, subject: durableConsumer.subject },
          durableConsumerLimits,
        ),
      });
    } else {
      const unset = unsetNamesOf(durableConsumerLimits, durableConsumerSettingNames).join(', ');
      const where = 'limits.durableConsumers or limits.durableConsumerDefaults';
      lines.push(`The Durable consumer ${name} has no ${unset} in ${where}`);
    }
  }
  return { planned, lines };
}
