import type { PerDurableConsumer, RedeliveryLimits } from '../broker-limits/index.ts';

/** A Durable consumer's settings inside the process that cf-loom has no opinion on, which the Service chooses for its local run. */
export type InProcessDurableConsumerLimits = RedeliveryLimits;

/** Every setting of the Durable consumers inside the process, keyed by the names the Broker plan prints, with defaults for whatever one does not set. */
export type InProcessBrokerLimits = PerDurableConsumer<InProcessDurableConsumerLimits>;
