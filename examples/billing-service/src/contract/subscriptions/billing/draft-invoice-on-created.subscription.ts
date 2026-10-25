import { defineSubscription } from '@cf-loom/contract';
import { contract as orders } from '@org/contract-orders-service';

export const draftInvoiceOnCreated = defineSubscription({
  name: 'draftInvoiceOnCreated',
  description: 'Drafts an invoice for each order created',
  event: orders.events.orderCreatedV1,
});
