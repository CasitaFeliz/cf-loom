import type { BrokerPlan } from '@cf-loom/contract/internal';
import type { ConsumerConfig, StreamConfig } from '@nats-io/jetstream';
import {
  type ReadBrokerLimits,
  type ReadConsumerLimits,
  type ReadStreamLimits,
  readLimits,
} from './limits.ts';
import { consumerConfigOf, streamConfigOf } from './nats-config.ts';

/** A stream of the plan with the NATS settings its limits resolve to. */
export type PlannedStream = {
  readonly name: string;
  readonly subjects: readonly string[];
  readonly settings: Partial<StreamConfig>;
};

/** A durable consumer of the plan with the NATS settings its limits resolve to. */
export type PlannedDurable = {
  readonly name: string;
  readonly stream: string;
  readonly settings: Partial<ConsumerConfig>;
};

/** Every stream and durable consumer of a plan with its settings. */
export type ResolvedPlan = {
  readonly kind: 'resolved';
  readonly streams: readonly PlannedStream[];
  readonly durables: readonly PlannedDurable[];
};

/** A plan with its settings, or a line for each reason the plan and its limits cannot be applied. */
export type PlanSettings =
  | ResolvedPlan
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

type Resolved<Planned> = { readonly planned: Planned[]; readonly lines: string[] };

const streamSettingNames = [
  'retention',
  'maxAge',
  'duplicateWindow',
  'replicas',
  'storage',
] as const satisfies readonly (keyof ReadStreamLimits)[];

const consumerSettingNames = [
  'deliverPolicy',
  'ackWait',
  'maxDeliver',
  'maxAckPending',
] as const satisfies readonly (keyof ReadConsumerLimits)[];

/**
 * The settings of each stream and durable consumer of the plan, from its own limits over the
 * defaults, in NATS's units; limits that break their shape, name what the plan does not list or
 * leave a setting unset are refused whole.
 */
export function settingsOf(plan: BrokerPlan, limits: unknown): PlanSettings {
  const read = readLimits(limits);
  if (read.kind === 'refused') {
    return read;
  }
  const streams = streamsOf(plan, read.limits);
  const durables = durablesOf(plan, read.limits);
  const lines = [...unlistedLinesOf(plan, read.limits), ...streams.lines, ...durables.lines];
  if (lines.length > 0) {
    return { kind: 'refused', lines };
  }
  return { kind: 'resolved', streams: streams.planned, durables: durables.planned };
}

function unlistedLinesOf(plan: BrokerPlan, limits: ReadBrokerLimits): readonly string[] {
  const streams = Object.keys(limits.streams ?? {}).filter(
    (name) => !Object.hasOwn(plan.streams, name),
  );
  const consumers = Object.keys(limits.consumers ?? {}).filter(
    (name) => !Object.hasOwn(plan.consumers, name),
  );
  return [
    ...streams.map((name) => `limits.streams names ${name}, which the plan does not list`),
    ...consumers.map((name) => `limits.consumers names ${name}, which the plan does not list`),
  ];
}

function unsetNamesOf<Name extends string>(
  settings: Partial<Record<Name, unknown>>,
  names: readonly Name[],
): readonly Name[] {
  return names.filter((name) => settings[name] === undefined);
}

function isStreamSet(settings: ReadStreamLimits): settings is Required<ReadStreamLimits> {
  return unsetNamesOf(settings, streamSettingNames).length === 0;
}

function isConsumerSet(settings: ReadConsumerLimits): settings is Required<ReadConsumerLimits> {
  return unsetNamesOf(settings, consumerSettingNames).length === 0;
}

function streamsOf(plan: BrokerPlan, limits: ReadBrokerLimits): Resolved<PlannedStream> {
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

function durablesOf(plan: BrokerPlan, limits: ReadBrokerLimits): Resolved<PlannedDurable> {
  const planned: PlannedDurable[] = [];
  const lines: string[] = [];
  for (const [name, consumer] of Object.entries(plan.consumers)) {
    const consumerLimits = { ...limits.consumerDefaults, ...limits.consumers?.[name] };
    if (isConsumerSet(consumerLimits)) {
      const durable = { name, subject: consumer.subject };
      const settings = consumerConfigOf(durable, consumerLimits);
      planned.push({ name, stream: consumer.stream, settings });
    } else {
      const unset = unsetNamesOf(consumerLimits, consumerSettingNames).join(', ');
      const where = 'limits.consumers or limits.consumerDefaults';
      lines.push(`The durable consumer ${name} has no ${unset} in ${where}`);
    }
  }
  return { planned, lines };
}
