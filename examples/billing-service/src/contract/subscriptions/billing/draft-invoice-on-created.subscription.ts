import { defineSubscription } from '@cf-loom/contract';
import { ordersDeps } from '../dependencies/orders-service.dependencies.ts';

export const draftInvoiceOnCreated = defineSubscription({
  name: 'draftInvoiceOnCreated',
  description: 'Drafts an invoice for each order created',
  event: ordersDeps.events.orderCreatedV1,
});
