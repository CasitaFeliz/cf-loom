// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import { AckPolicy, type ConsumerConfig } from '@nats-io/jetstream';

/** One setting of a pull consumer cf-loom pulls from: the value `applyBrokerPlan` writes, `undefined` to clear it, and how a Durable consumer differs in it. */
type ShapeSetting = {
  readonly value: (subject: string) => unknown;
  readonly difference: (config: ConsumerConfig, subject: string) => string | undefined;
};

/** A setting `applyBrokerPlan` clears whose own value is no difference: another setting's difference reports it. */
const cleared = { value: (): undefined => undefined, difference: (): undefined => undefined };

/** Every setting that decides whether a Durable consumer is one cf-loom pulls from, so what `applyBrokerPlan` writes and what `consume` refuses cannot drift apart. */
const shapeSettings = {
  deliver_subject: {
    ...cleared,
    difference: (config) => {
      return config.deliver_subject ? 'is a push consumer, not a pull consumer' : undefined;
    },
  },
  ack_policy: {
    value: () => AckPolicy.Explicit,
    difference: (config) => {
      const pulled = AckPolicy.Explicit;
      return config.ack_policy === pulled
        ? undefined
        : `has the ack policy ${config.ack_policy}, not ${pulled}`;
    },
  },
  filter_subject: {
    value: (subject: string) => subject,
    difference: (config, subject) => {
      const filters = filtersOf(config);
      if (filters.length === 1 && filters[0] === subject) {
        return undefined;
      }
      const filtered = filters.length === 0 ? 'every subject' : filters.join(', ');
      return `filters ${filtered}, not ${subject}`;
    },
  },
  filter_subjects: cleared,
  headers_only: {
    value: (): false => false,
    difference: (config) => {
      return config.headers_only ? "delivers headers only, not the Message's body" : undefined;
    },
  },
  priority_groups: {
    ...cleared,
    difference: (config) => {
      const groups = config.priority_groups ?? [];
      if (groups.length === 0) {
        return undefined;
      }
      const policy = config.priority_policy;
      return `has the priority groups ${groups.join(', ')} with the policy ${policy}, which a pull must name`;
    },
  },
  priority_policy: cleared,
  priority_timeout: cleared,
} satisfies Record<string, ShapeSetting>;

type DurableShape = {
  readonly [Name in keyof typeof shapeSettings]: ReturnType<(typeof shapeSettings)[Name]['value']>;
};

/** A Durable consumer's settings as `applyBrokerPlan` sends them: NATS's own, with every setting of the shape named, so those that make a Durable consumer not one cf-loom pulls from are always cleared. */
export type DurableSettings = Omit<Partial<ConsumerConfig>, keyof DurableShape> & DurableShape;

/** The settings that make a Durable consumer one cf-loom pulls from, whoever creates it: explicit acknowledgements, filtered on its subject, its Messages' bodies delivered, no deliver subject and no priority groups. */
export function durableShapeOf(subject: string): DurableShape {
  const entries = Object.entries(shapeSettings).map(([name, setting]) => {
    return [name, setting.value(subject)];
  });
  return Object.fromEntries(entries) as DurableShape;
}

/** How an existing Durable consumer differs from a pull consumer of `durableShapeOf(subject)`; none when it is one. */
export function shapeDifferencesOf(config: ConsumerConfig, subject: string): readonly string[] {
  const differences = Object.values(shapeSettings).map((setting) => {
    return setting.difference(config, subject);
  });
  return differences.filter(isDifference);
}

function isDifference(difference: string | undefined): difference is string {
  return difference !== undefined;
}

function filtersOf(config: ConsumerConfig): readonly string[] {
  if (config.filter_subjects !== undefined && config.filter_subjects.length > 0) {
    return config.filter_subjects;
  }
  return config.filter_subject ? [config.filter_subject] : [];
}
