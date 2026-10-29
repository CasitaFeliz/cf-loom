import { type Closed, type Problem, problemLineOf, readWith } from '@cf-loom/contract/internal';
import { z } from 'zod';

/** Some of a Stream's or Durable consumer's settings, each possibly `undefined`, which leaves it unset like a missing key. */
type Some<Limits> = { readonly [Name in keyof Limits]?: Limits[Name] | undefined };

/** A type written out as one object type, which an intersection of object types is not. */
type Flat<Type> = { [Name in keyof Type]: Type[Name] };

/** The defaults of every Stream's settings, and each Stream's own, keyed by the names the plan prints. */
export type PerStream<StreamLimits> = {
  readonly streamDefaults?: Some<StreamLimits> | undefined;
  readonly streams?: Readonly<Record<string, Some<StreamLimits> | undefined>> | undefined;
};

/** The defaults of every Durable consumer's settings, and each Durable consumer's own, keyed by the names the plan prints. */
export type PerDurableConsumer<DurableConsumerLimits> = {
  readonly durableConsumerDefaults?: Some<DurableConsumerLimits> | undefined;
  readonly durableConsumers?:
    | Readonly<Record<string, Some<DurableConsumerLimits> | undefined>>
    | undefined;
};

/** The limits of a Broker with settings per Stream and per Durable consumer, as one object type. */
export type LimitsOf<StreamLimits, DurableConsumerLimits> = Flat<
  PerStream<StreamLimits> & PerDurableConsumer<DurableConsumerLimits>
>;

/** The limits' defaults, those `Limits` has: each holds no setting its limits do not declare. */
export type DefaultsFields<Given, Limits> = {
  readonly [Field in Extract<keyof Limits, 'streamDefaults' | 'durableConsumerDefaults'>]?:
    | Closed<
        Given extends { readonly [Name in Field]?: infer Defaults } ? Defaults : unknown,
        NonNullable<Limits[Field]>
      >
    | undefined;
};

/** Limits with every setting set. */
export type SetLimits<Limits> = {
  readonly [Name in keyof Limits]-?: Exclude<Limits[Name], undefined>;
};

/** The readers of one kind's settings, one per setting. */
export type Readers = Readonly<Record<string, z.ZodType>>;

/** One kind's settings as its readers read them, each possibly unset. */
export type ReadOf<Reading extends Readers> = {
  readonly [Name in keyof Reading]?: z.output<Reading[Name]>;
};

/** The limits as read: every setting of a kind in its adapter's units, and no `undefined` anywhere. */
export type Container<StreamReaders extends Readers, DurableConsumerReaders extends Readers> = {
  readonly streamDefaults?: ReadOf<StreamReaders> | undefined;
  readonly streams?: Readonly<Record<string, ReadOf<StreamReaders>>> | undefined;
  readonly durableConsumerDefaults?: ReadOf<DurableConsumerReaders> | undefined;
  readonly durableConsumers?: Readonly<Record<string, ReadOf<DurableConsumerReaders>>> | undefined;
};

/** The container's keys of a Broker without per-Stream settings. */
type DurableConsumerFields<DurableConsumerReaders extends Readers> = Pick<
  Container<Readers, DurableConsumerReaders>,
  'durableConsumerDefaults' | 'durableConsumers'
>;

/** The readers of the kinds an adapter's Broker has settings for; a Broker without per-Stream settings has no `stream`. */
export type KindReaders<StreamReaders extends Readers, DurableConsumerReaders extends Readers> = {
  readonly stream?: StreamReaders | undefined;
  readonly durableConsumer: DurableConsumerReaders;
};

/** The limits read, or one line for each place they break their shape. */
export type ReadContainer<StreamReaders extends Readers, DurableConsumerReaders extends Readers> =
  | { readonly kind: 'read'; readonly limits: Container<StreamReaders, DurableConsumerReaders> }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

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

/** One kind's strict settings, each optional, as `ReadOf` types them: zod cannot see the settings of readers it is given generically. */
function settingsSchemaOf<Reading extends Readers>(readers: Reading) {
  const settings = z.strictObject(readers).partial();
  const names = settings.keyof().options;
  return settings.transform((read) => definedOf(names, read)) as z.ZodType<ReadOf<Reading>>;
}

/** The defaults of one kind's settings, and each name's own, as the container holds them under that kind's two keys. */
function perKindOf<Reading extends Readers>(readers: Reading) {
  const settings = settingsSchemaOf(readers);
  return {
    defaults: settings.optional(),
    entries: z.record(z.string(), settings.optional()).transform(entriesOf).optional(),
  };
}

function containerOf<StreamReaders extends Readers, DurableConsumerReaders extends Readers>(
  kinds: KindReaders<StreamReaders, DurableConsumerReaders>,
) {
  const durableConsumer = perKindOf(kinds.durableConsumer);
  if (kinds.stream === undefined) {
    return z.strictObject({
      durableConsumerDefaults: durableConsumer.defaults,
      durableConsumers: durableConsumer.entries,
    } satisfies Record<keyof DurableConsumerFields<DurableConsumerReaders>, z.ZodType>);
  }
  const stream = perKindOf(kinds.stream);
  return z.strictObject({
    streamDefaults: stream.defaults,
    durableConsumerDefaults: durableConsumer.defaults,
    streams: stream.entries,
    durableConsumers: durableConsumer.entries,
  } satisfies Record<keyof Container<StreamReaders, DurableConsumerReaders>, z.ZodType>);
}

/** Reads the limits an adapter's `applyBrokerPlan` took, which only a JSON file or untyped code can get wrong. */
export function readContainer<
  StreamReaders extends Readers,
  DurableConsumerReaders extends Readers,
>(
  kinds: KindReaders<StreamReaders, DurableConsumerReaders>,
  limits: unknown,
  definer: string,
): ReadContainer<StreamReaders, DurableConsumerReaders> {
  const read = readWith(containerOf(kinds), limits, definer);
  if (read.kind === 'refused') {
    return { kind: 'refused', lines: read.problems.map(lineOf) };
  }
  return { kind: 'read', limits: read.value };
}

function lineOf(problem: Problem): string {
  return problemLineOf({ at: ['limits', ...problem.at], reason: problem.reason });
}
