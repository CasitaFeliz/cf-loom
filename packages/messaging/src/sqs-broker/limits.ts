import type { Duration, PerDurableConsumer } from '../broker-limits/index.ts';

/** A Durable consumer's settings on SNS/SQS that cf-loom has no opinion on, which the organization chooses. */
export type SqsDurableConsumerLimits = {
  /** How long a delivery waits before it comes again, or one wait per delivery, the last repeating; whole seconds, each under 12h. */
  readonly ackWait: Duration | readonly Duration[];
  /** How many times a Message is delivered at most, 1 to 1,000, moving it to the dead-letter queue after; SQS caps deliveries only through one, so there is no `'unlimited'`. */
  readonly maxDeliver: number;
  /** How long the queue keeps a Message, 1m to 14d. */
  readonly retention: Duration;
  /** How long the dead-letter queue keeps a Message, 1m to 14d; it counts from when the Message was first sent, so it should exceed `retention`. */
  readonly deadLetterRetention: Duration;
};

/** Every setting of the plan's Durable consumers on SNS/SQS, keyed by the names the plan prints, with defaults for whatever one does not set. */
export type SqsBrokerLimits = PerDurableConsumer<SqsDurableConsumerLimits>;
