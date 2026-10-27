// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import type { StreamConfig } from '@nats-io/jetstream';
import { type DurableConsumerSettings, durableConsumerShapeOf } from './durable-consumer-shape.ts';
import type { NatsDurableConsumerLimits, NatsStreamLimits, SetLimits } from './reading-limits.ts';

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
 * A Durable consumer's limits as the NATS settings nats.js takes for a pull consumer, the same for
 * creating it and for updating it; the backoff is always sent, empty for one ack wait, so an update clears an old one.
 */
export function durableConsumerConfigOf(
  durableConsumer: { readonly name: string; readonly subject: string },
  limits: SetLimits<NatsDurableConsumerLimits>,
): DurableConsumerSettings {
  const [firstWait, ...laterWaits] = limits.ackWait;
  return {
    durable_name: durableConsumer.name,
    ...durableConsumerShapeOf(durableConsumer.subject),
    deliver_policy: limits.deliverPolicy,
    ack_wait: firstWait,
    backoff: laterWaits.length === 0 ? [] : [...limits.ackWait],
    max_deliver: limits.maxDeliver,
    max_ack_pending: limits.maxAckPending,
  };
}
