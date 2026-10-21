import type { money } from '@org/definitions';
import type { z } from 'zod';

/** What a card was charged for one order. */
export type Charge = { readonly orderId: string; readonly total: z.infer<typeof money> };

/** The charges this fictional Service has made, one record each, standing in for its database. */
const charges: Charge[] = [];

/** Charges the order's card for its total unless it was already charged: a repeated Message changes nothing. */
export function chargeOnce(orderId: string, total: Charge['total']): void {
  if (chargesOf(orderId).length > 0) return;
  charges.push({ orderId, total });
}

/** The charges made for this order. */
export function chargesOf(orderId: string): readonly Charge[] {
  return charges.filter((charge) => charge.orderId === orderId);
}
