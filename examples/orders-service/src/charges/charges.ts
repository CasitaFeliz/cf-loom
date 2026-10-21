import type { money } from '@org/definitions';
import type { z } from 'zod';

/** What a card was charged for one order. */
export type Charge = { readonly orderId: string; readonly total: z.infer<typeof money> };

/** The charges this fictional Service has made, standing in for its database. */
const chargeByOrderId = new Map<string, Charge>();

/** Charges the order's card for its total unless it was already charged: a repeated Message changes nothing. */
export function chargeOnce(orderId: string, total: Charge['total']): void {
  if (chargeByOrderId.has(orderId)) return;
  chargeByOrderId.set(orderId, { orderId, total });
}

/** The charges made for this order: one, or none. */
export function chargesOf(orderId: string): readonly Charge[] {
  const charge = chargeByOrderId.get(orderId);
  return charge === undefined ? [] : [charge];
}
