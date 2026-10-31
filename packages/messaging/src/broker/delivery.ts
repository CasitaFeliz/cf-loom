import type { Delivery } from './broker.ts';

/** The waits the Broker gives a Durable consumer's first deliveries to be acknowledged, in milliseconds, the last repeating for every later one. */
export type DeliveryWaits = readonly [number, ...number[]];

/** What a Durable consumer holds that decides each Delivery: its waits and how many deliveries it makes at most, `-1` for no limit. */
export type DeliveryLimits = {
  readonly waits: DeliveryWaits;
  readonly maxDeliver: number;
};

/** A Message as the Broker holds it: what every Delivery of it carries unchanged. */
export type HeldMessage = Pick<Delivery, 'messageId' | 'factId' | 'headers' | 'body'>;

/** How long the Broker waits for a Delivery's acknowledgement: the wait of that Delivery among the waits of the first deliveries, the last repeating; the first when the count is no whole number from 1. */
function deliveryWaitOf(waits: DeliveryWaits, deliveryCount: number): number {
  const index = Math.min(deliveryCount, waits.length) - 1;
  return waits[index] ?? waits[0];
}

/** Whether the Broker delivers no more after this delivery: a limit set, and reached. */
function isLastDelivery(maxDeliver: number, deliveryCount: number): boolean {
  return maxDeliver > 0 && deliveryCount >= maxDeliver;
}

/** The Delivery of a held Message as its Durable consumer's limits decide it: which attempt, whether the last, and its wait, always known. */
export function deliveryOf(
  limits: DeliveryLimits,
  message: HeldMessage,
  deliveryCount: number,
): Delivery & { readonly waitMs: number } {
  const { messageId, factId, headers, body } = message;
  const lastAttempt = isLastDelivery(limits.maxDeliver, deliveryCount);
  const waitMs = deliveryWaitOf(limits.waits, deliveryCount);
  return { messageId, factId, deliveryCount, lastAttempt, waitMs, headers, body };
}
