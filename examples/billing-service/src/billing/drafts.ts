import type { orderCreatedEventV1 } from '@org/contract-orders-service';
import type { z } from 'zod';

type OrderCreated = z.infer<typeof orderCreatedEventV1.body>;

/** An invoice started for one order, for its total, not yet sent. */
export type DraftInvoice = { readonly orderId: string; readonly total: OrderCreated['total'] };

/** The draft invoices this fictional Service has made, one record each, standing in for its database. */
const drafts: DraftInvoice[] = [];

/** Drafts the order's invoice unless it has one: a repeated Message changes nothing. */
export function draftOnce(orderId: string, total: DraftInvoice['total']): void {
  if (draftsOf(orderId).length > 0) return;
  drafts.push({ orderId, total });
}

/** The draft invoices made for this order. */
export function draftsOf(orderId: string): readonly DraftInvoice[] {
  return drafts.filter((draft) => draft.orderId === orderId);
}
