import type { z } from 'zod';
import type { ordersDeps } from '../contract/dependencies/orders-service.dependencies.ts';

type OrderCreated = z.infer<typeof ordersDeps.events.orderCreatedV1.body>;

/** An invoice started for one order, for its total, not yet sent. */
export type DraftInvoice = { readonly orderId: string; readonly total: OrderCreated['total'] };

/** The draft invoices this fictional Service has made, standing in for its database. */
const draftByOrderId = new Map<string, DraftInvoice>();

/** Drafts the order's invoice unless it has one: a repeated Message changes nothing. */
export function draftOnce(orderId: string, total: DraftInvoice['total']): void {
  if (draftByOrderId.has(orderId)) return;
  draftByOrderId.set(orderId, { orderId, total });
}

/** The draft invoices made for this order: one, or none. */
export function draftsOf(orderId: string): readonly DraftInvoice[] {
  const draft = draftByOrderId.get(orderId);
  return draft === undefined ? [] : [draft];
}
