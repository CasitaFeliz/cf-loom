import type { BrokerPlan } from '@cf-loom/contract/internal';
import type { ConsumerConfig, StreamConfig } from '@nats-io/jetstream';
import { durableConfigOf, streamConfigOf } from './nats-config.ts';
import {
  durableSettingNames,
  type NatsBrokerLimits,
  type NatsDurableLimits,
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

function unlistedLinesOf(plan: BrokerPlan, limits: NatsBrokerLimits): readonly string[] {
  const streams = unlistedNamesOf(plan.streams, limits.streams);
  const consumers = unlistedNamesOf(plan.consumers, limits.consumers);
  return [
    ...streams.map((name) => `limits.streams names ${name}, which the plan does not list`),
    ...consumers.map((name) => `limits.consumers names ${name}, which the plan does not list`),
  ];
}

/** The names limits holds an entry for that the plan does not list; an `undefined` entry is none. */
function unlistedNamesOf(
  listed: Readonly<Record<string, unknown>>,
  entries: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  return Object.entries(entries ?? {})
    .filter(([name, entry]) => entry !== undefined && !Object.hasOwn(listed, name))
    .map(([name]) => name);
}

/** A stream's or durable consumer's own settings over the defaults; an own setting left `undefined` leaves the default. */
function overlaid<Limits extends object>(
  names: readonly (keyof Limits)[],
  defaults: Limits | undefined,
  own: Limits | undefined,
): Partial<Limits> {
  const merged: Partial<Limits> = { ...defaults };
  for (const name of names) {
    const setting = own?.[name];
    if (setting !== undefined) {
      merged[name] = setting;
    }
  }
  return merged;
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

function isDurableSet(limits: NatsDurableLimits): limits is SetLimits<NatsDurableLimits> {
  return unsetNamesOf(limits, durableSettingNames).length === 0;
}

function streamsOf(plan: BrokerPlan, limits: NatsBrokerLimits): Resolved<PlannedStream> {
  const planned: PlannedStream[] = [];
  const lines: string[] = [];
  for (const [name, stream] of Object.entries(plan.streams)) {
    const own = limits.streams?.[name];
    const streamLimits = overlaid(streamSettingNames, limits.streamDefaults, own);
    if (isStreamSet(streamLimits)) {
      planned.push({ name, subjects: stream.subjects, settings: streamConfigOf(streamLimits) });
    } else {
      const unset = unsetNamesOf(streamLimits, streamSettingNames).join(', ');
      lines.push(`The stream ${name} has no ${unset} in limits.streams or limits.streamDefaults`);
    }
  }
  return { planned, lines };
}

function durablesOf(plan: BrokerPlan, limits: NatsBrokerLimits): Resolved<PlannedDurable> {
  const planned: PlannedDurable[] = [];
  const lines: string[] = [];
  for (const [name, consumer] of Object.entries(plan.consumers)) {
    const own = limits.consumers?.[name];
    const durableLimits = overlaid(durableSettingNames, limits.consumerDefaults, own);
    if (isDurableSet(durableLimits)) {
      const durable = { name, subject: consumer.subject };
      planned.push({
        name,
        stream: consumer.stream,
        settings: durableConfigOf(durable, durableLimits),
      });
    } else {
      const unset = unsetNamesOf(durableLimits, durableSettingNames).join(', ');
      const where = 'limits.consumers or limits.consumerDefaults';
      lines.push(`The durable consumer ${name} has no ${unset} in ${where}`);
    }
  }
  return { planned, lines };
}
