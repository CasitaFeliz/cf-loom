import type { ConsumerConfig } from '@nats-io/jetstream';
import { millis } from '@nats-io/nats-core';

/** The wait NATS gives a durable consumer's delivery when its configuration holds none. */
const natsAckWaitMs = 30_000;

/** The waits NATS gives a durable consumer's deliveries to be acknowledged, in milliseconds. */
export type Waits = { readonly ackWait: number; readonly backoff: readonly number[] };

/** The waits a durable consumer's configuration holds, which the server always fills in. */
export function waitsOf(config: ConsumerConfig): Waits {
  const ackWait = config.ack_wait === undefined ? natsAckWaitMs : millis(config.ack_wait);
  return { ackWait, backoff: (config.backoff ?? []).map((wait) => millis(wait)) };
}

/** How long NATS waits for a delivery's acknowledgement: its backoff entry, the last one repeating, or the ack wait. */
export function waitOf(waits: Waits, deliveryCount: number): number {
  if (waits.backoff.length === 0) {
    return waits.ackWait;
  }
  const index = Math.min(deliveryCount, waits.backoff.length) - 1;
  return waits.backoff[index] ?? waits.ackWait;
}
