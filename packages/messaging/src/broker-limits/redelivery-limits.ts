import type { Duration } from './duration.ts';

/** How a Durable consumer redelivers a Message: how long each delivery waits, and how many deliveries it makes at most. */
export type RedeliveryLimits = {
  /** How long a delivery waits for its acknowledgement before it comes again, or one wait per delivery, the last repeating. */
  readonly ackWait: Duration | readonly Duration[];
  /** How many times a Message is delivered at most, or `'unlimited'`. */
  readonly maxDeliver: number | 'unlimited';
};
