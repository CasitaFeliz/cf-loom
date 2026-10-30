import type { ConsumerConfig } from '@nats-io/jetstream';
import { millis } from '@nats-io/nats-core';
import type { DeliveryWaits } from '../broker-limits/index.ts';

/** The wait NATS gives a Durable consumer's delivery when its configuration holds none. */
const natsAckWaitMs = 30_000;

/** The waits NATS gives a Durable consumer's first deliveries to be acknowledged, in milliseconds: its backoff, or its ack wait alone, which the server always fills in. */
export function waitsOf(config: ConsumerConfig): DeliveryWaits {
  const [first, ...later] = (config.backoff ?? []).map((wait) => millis(wait));
  if (first !== undefined) {
    return [first, ...later];
  }
  return [config.ack_wait === undefined ? natsAckWaitMs : millis(config.ack_wait)];
}
