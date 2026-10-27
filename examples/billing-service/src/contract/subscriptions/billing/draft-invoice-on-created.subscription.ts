import { defineSubscription } from '@cf-loom/contract';
import { orderCreatedEventV1 } from '@org/contract-orders-service';

export const draftInvoiceOnCreated = defineSubscription({
  name: 'draftInvoiceOnCreated',
  description: 'Drafts an invoice for each order created',
  event: orderCreatedEventV1,
});
