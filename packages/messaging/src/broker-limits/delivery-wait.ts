/** The waits the Broker gives a Durable consumer's first deliveries to be acknowledged, in milliseconds, the last repeating for every later one. */
export type DeliveryWaits = readonly [number, ...number[]];

/** How long the Broker waits for a Delivery's acknowledgement: the wait of that Delivery among the waits of the first deliveries, the last repeating; the first when the count is no whole number from 1. */
export function deliveryWaitOf(waits: DeliveryWaits, deliveryCount: number): number {
  const index = Math.min(deliveryCount, waits.length) - 1;
  return waits[index] ?? waits[0];
}
