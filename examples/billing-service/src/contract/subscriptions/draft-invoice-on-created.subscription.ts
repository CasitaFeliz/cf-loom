import { defineSubscription } from '@cf-loom/contract';
import { ordersDeps } from '../dependencies/orders-service.dependencies.ts';

export const draftInvoiceOnCreated = defineSubscription({
  name: 'draft-invoice-on-created',
  event: ordersDeps.events.orderCreatedV1,
});
