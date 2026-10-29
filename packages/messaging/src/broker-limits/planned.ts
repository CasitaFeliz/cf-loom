import {
  type BrokerPlan,
  type BrokerPlanDurableConsumer,
  type BrokerPlanStream,
  decodeBrokerPlan,
} from '@cf-loom/contract/internal';
import {
  type Container,
  type Readers,
  type ReadOf,
  readContainer,
  type SetLimits,
} from './container.ts';

/** What one Stream's or Durable consumer's settings, its own over the defaults, resolve to: the adapter's settings, or the settings left unset. */
export type Resolution<Planned> =
  | { readonly kind: 'planned'; readonly planned: Planned }
  | { readonly kind: 'unset'; readonly names: readonly [string, ...string[]] };

/** One kind's limits: its readers, and how the merged settings of a Stream or Durable consumer the plan lists resolve. */
export type KindLimits<Reading extends Readers, Listed, Planned> = {
  readonly readers: Reading;
  readonly resolve: (name: string, listed: Listed, limits: ReadOf<Reading>) => Resolution<Planned>;
};

/** Settings with every one of `names` set, or the names left unset, in their order. */
export function everySetOf<Read, Name extends keyof Read>(
  limits: Read,
  names: readonly Name[],
):
  | { readonly kind: 'set'; readonly limits: SetLimits<Pick<Read, Name>> & Read }
  | { readonly kind: 'unset'; readonly names: readonly [Name, ...Name[]] } {
  const [first, ...later] = names.filter((name) => limits[name] === undefined);
  return first === undefined
    ? { kind: 'set', limits: limits as SetLimits<Pick<Read, Name>> & Read }
    : { kind: 'unset', names: [first, ...later] };
}

type Refused = { readonly kind: 'refused'; readonly message: string };

type Unset = { readonly name: string; readonly names: readonly [string, ...string[]] };

type Resolved<Planned> = { readonly planned: Planned[]; readonly unset: Unset[] };

/** The defaults and each name's own settings of one kind, as the limits were read. */
type Given<Reading extends Readers> = {
  readonly defaults: ReadOf<Reading> | undefined;
  readonly entries: Readonly<Record<string, ReadOf<Reading>>> | undefined;
};

function decodedOf(
  plan: unknown,
): { readonly kind: 'decoded'; readonly plan: BrokerPlan } | Refused {
  const decoded = decodeBrokerPlan(plan);
  if (decoded.kind === 'malformed') {
    const shape =
      'The value is not the Broker plan of the document cf-loom broker-plan --json prints';
    return { kind: 'refused', message: `${shape}: ${decoded.reason}` };
  }
  return decoded;
}

function unlistedLinesOf<StreamReaders extends Readers, DurableConsumerReaders extends Readers>(
  plan: BrokerPlan,
  limits: Container<StreamReaders, DurableConsumerReaders>,
): readonly string[] {
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

/** Each name the plan lists, in plan order, with the settings its own limits over the defaults resolve to. */
function resolvedOf<Reading extends Readers, Listed, Planned>(
  listed: Readonly<Record<string, Listed>>,
  given: Given<Reading>,
  kind: KindLimits<Reading, Listed, Planned>,
): Resolved<Planned> {
  const planned: Planned[] = [];
  const unset: Unset[] = [];
  for (const [name, entry] of Object.entries(listed)) {
    const limits = { ...given.defaults, ...given.entries?.[name] } as ReadOf<Reading>;
    const resolution = kind.resolve(name, entry, limits);
    if (resolution.kind === 'planned') {
      planned.push(resolution.planned);
    } else {
      unset.push({ name, names: resolution.names });
    }
  }
  return { planned, unset };
}

function streamsOf<
  StreamReaders extends Readers,
  DurableConsumerReaders extends Readers,
  StreamPlanned,
>(
  plan: BrokerPlan,
  limits: Container<StreamReaders, DurableConsumerReaders>,
  kind: KindLimits<StreamReaders, BrokerPlanStream, StreamPlanned> | undefined,
): Resolved<StreamPlanned> {
  if (kind === undefined) {
    return { planned: [], unset: [] };
  }
  return resolvedOf(
    plan.streams,
    { defaults: limits.streamDefaults, entries: limits.streams },
    kind,
  );
}

function durableConsumersOf<
  StreamReaders extends Readers,
  DurableConsumerReaders extends Readers,
  DurableConsumerPlanned,
>(
  plan: BrokerPlan,
  limits: Container<StreamReaders, DurableConsumerReaders>,
  kind: KindLimits<DurableConsumerReaders, BrokerPlanDurableConsumer, DurableConsumerPlanned>,
): Resolved<DurableConsumerPlanned> {
  const given = { defaults: limits.durableConsumerDefaults, entries: limits.durableConsumers };
  return resolvedOf(plan.durableConsumers, given, kind);
}

function unsetStreamLine({ name, names }: Unset): string {
  return `The stream ${name} has no ${names.join(', ')} in limits.streams or limits.streamDefaults`;
}

function unsetDurableConsumerLine({ name, names }: Unset): string {
  const where = 'limits.durableConsumers or limits.durableConsumerDefaults';
  return `The Durable consumer ${name} has no ${names.join(', ')} in ${where}`;
}

/**
 * The plan, and its Streams and Durable consumers with the settings their limits resolve to, or the one message that
 * refuses them: a value that is not the Broker plan `broker-plan --json` prints, limits that break their shape
 * (worded for `definer`, such as `BrokerLimits`), name what the plan does not list, or leave a setting unset. Without
 * a `stream` kind, the limits hold no per-Stream settings and `streams` is empty.
 */
export function plannedOf<
  StreamReaders extends Readers,
  DurableConsumerReaders extends Readers,
  StreamPlanned = never,
  DurableConsumerPlanned = never,
>(
  plan: unknown,
  limits: unknown,
  adapter: {
    readonly definer: string;
    readonly stream?: KindLimits<StreamReaders, BrokerPlanStream, StreamPlanned>;
    readonly durableConsumer: KindLimits<
      DurableConsumerReaders,
      BrokerPlanDurableConsumer,
      DurableConsumerPlanned
    >;
  },
):
  | {
      readonly kind: 'planned';
      readonly plan: BrokerPlan;
      readonly streams: readonly StreamPlanned[];
      readonly durableConsumers: readonly DurableConsumerPlanned[];
    }
  | Refused {
  const decoded = decodedOf(plan);
  if (decoded.kind === 'refused') {
    return decoded;
  }
  const readers = {
    stream: adapter.stream?.readers,
    durableConsumer: adapter.durableConsumer.readers,
  };
  const read = readContainer(readers, limits, adapter.definer);
  if (read.kind === 'refused') {
    return { kind: 'refused', message: read.lines.join('\n') };
  }
  const streams = streamsOf(decoded.plan, read.limits, adapter.stream);
  const durableConsumers = durableConsumersOf(decoded.plan, read.limits, adapter.durableConsumer);
  const lines = [
    ...unlistedLinesOf(decoded.plan, read.limits),
    ...streams.unset.map(unsetStreamLine),
    ...durableConsumers.unset.map(unsetDurableConsumerLine),
  ];
  if (lines.length > 0) {
    return { kind: 'refused', message: lines.join('\n') };
  }
  return {
    kind: 'planned',
    plan: decoded.plan,
    streams: streams.planned,
    durableConsumers: durableConsumers.planned,
  };
}
