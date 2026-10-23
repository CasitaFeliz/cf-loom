// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import { AckPolicy, type ConsumerConfig } from '@nats-io/jetstream';

/** The settings that make a durable consumer one cf-loom pulls from, whoever creates it: explicit acknowledgements, filtered on its subject. */
export function durableShapeOf(subject: string): {
  readonly ack_policy: AckPolicy;
  readonly filter_subject: string;
} {
  return { ack_policy: AckPolicy.Explicit, filter_subject: subject };
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
  return differences;
}

function filtersOf(config: ConsumerConfig): readonly string[] {
  if (config.filter_subjects !== undefined && config.filter_subjects.length > 0) {
    return config.filter_subjects;
  }
  return config.filter_subject ? [config.filter_subject] : [];
}
