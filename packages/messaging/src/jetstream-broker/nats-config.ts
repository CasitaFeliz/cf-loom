// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import type { ConsumerConfig, StreamConfig } from '@nats-io/jetstream';
import { durableShapeOf } from './durable-shape.ts';
import type { NatsDurableLimits, NatsStreamLimits, SetLimits } from './reading-limits.ts';

/** A stream's limits as the NATS settings nats.js takes, the same for creating the stream and for updating it. */
export function streamConfigOf(limits: SetLimits<NatsStreamLimits>): Partial<StreamConfig> {
  return {
    retention: limits.retention,
    storage: limits.storage,
    max_age: limits.maxAge,
    duplicate_window: limits.duplicateWindow,
    num_replicas: limits.replicas,
  };
}

/**
 * A pull durable consumer's limits as the NATS settings nats.js takes, the same for creating it and
 * for updating it; the backoff is always sent, empty for one ack wait, so an update clears an old one.
 */
export function durableConfigOf(
  durable: { readonly name: string; readonly subject: string },
  limits: SetLimits<NatsDurableLimits>,
): Partial<ConsumerConfig> {
  const [firstWait, ...laterWaits] = limits.ackWait;
  return {
    durable_name: durable.name,
    ...durableShapeOf(durable.subject),
    deliver_policy: limits.deliverPolicy,
    ack_wait: firstWait,
    backoff: laterWaits.length === 0 ? [] : [...limits.ackWait],
    max_deliver: limits.maxDeliver,
    max_ack_pending: limits.maxAckPending,
  };
}
