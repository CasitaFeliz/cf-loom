import type { ConsumerConfig } from '@nats-io/jetstream';
import { millis } from '@nats-io/nats-core';
import type { PulledMessage } from './pulled-message.ts';

/** The wait NATS gives a durable consumer's delivery when its configuration holds none. */
const natsAckWaitMs = 30_000;

/** The longest delay a Node timer takes; a longer one runs after 1 ms. */
const longestTimerMs = 2_147_483_647;

/** How many in-progress acknowledgements fit in a delivery's wait, so one that is lost or late leaves a second chance. */
const inProgressPerWait = 3;

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

/** Runs `run` while sending the Message in-progress acknowledgements, so NATS does not give it to another process meanwhile. */
export async function whileWorking<Result>(
  message: PulledMessage,
  wait: number,
  run: () => Promise<Result>,
): Promise<Result> {
  const interval = Math.min(wait / inProgressPerWait, longestTimerMs);
  const timer = setInterval(() => message.working(), interval);
  try {
    return await run();
  } finally {
    clearInterval(timer);
  }
}
