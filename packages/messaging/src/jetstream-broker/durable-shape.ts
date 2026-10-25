// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import { AckPolicy, type ConsumerConfig } from '@nats-io/jetstream';

type ClearedKey = 'deliver_subject' | 'priority_groups' | 'priority_policy' | 'priority_timeout';

/** A durable consumer's settings as `apply` sends them: NATS's own, with the settings of a consumer cf-loom does not pull from named so they are always cleared. */
export type DurableSettings = Omit<Partial<ConsumerConfig>, ClearedKey> & {
  readonly [Key in ClearedKey]: undefined;
};

/** The settings `durableShapeOf` names, each with the one value a pull consumer of cf-loom's has. */
type DurableShape = Pick<DurableSettings, ClearedKey> & {
  readonly ack_policy: AckPolicy;
  readonly filter_subject: string;
  readonly headers_only: false;
};

/** The settings that make a durable consumer one cf-loom pulls from, whoever creates it: explicit acknowledgements, filtered on its subject, its Messages' bodies delivered, no deliver subject and no priority groups. */
export function durableShapeOf(subject: string): DurableShape {
  return {
    ack_policy: AckPolicy.Explicit,
    filter_subject: subject,
    headers_only: false,
    deliver_subject: undefined,
    priority_groups: undefined,
    priority_policy: undefined,
    priority_timeout: undefined,
  };
}

/** How an existing durable consumer differs from a pull consumer of `durableShapeOf(subject)`; none when it is one. */
export function shapeDifferencesOf(config: ConsumerConfig, subject: string): readonly string[] {
  const shape = durableShapeOf(subject);
  const differences: string[] = [];
  if (config.deliver_subject) {
    differences.push('is a push consumer, not a pull consumer');
  }
  if (config.ack_policy !== shape.ack_policy) {
    differences.push(`has the ack policy ${config.ack_policy}, not ${shape.ack_policy}`);
  }
  const filters = filtersOf(config);
  if (filters.length !== 1 || filters[0] !== shape.filter_subject) {
    const filtered = filters.length === 0 ? 'every subject' : filters.join(', ');
    differences.push(`filters ${filtered}, not ${shape.filter_subject}`);
  }
  if ((config.headers_only ?? false) !== shape.headers_only) {
    differences.push("delivers headers only, not the Message's body");
  }
  const groups = config.priority_groups ?? [];
  if (groups.length > 0) {
    const policy = config.priority_policy;
    differences.push(
      `has the priority groups ${groups.join(', ')} with the policy ${policy}, which a pull must name`,
    );
  }
  return differences;
}

function filtersOf(config: ConsumerConfig): readonly string[] {
  if (config.filter_subjects !== undefined && config.filter_subjects.length > 0) {
    return config.filter_subjects;
  }
  return config.filter_subject ? [config.filter_subject] : [];
}
