import { defineContract } from '@cf-loom/contract';
import { definitions as orgDefinitions } from '@org/definitions';
import { ordersDeps } from './dependencies/orders-service.dependencies.ts';
import { invoicesGroup } from './endpoints/invoices/invoices.group.ts';
import { draftInvoiceOnCreated } from './subscriptions/draft-invoice-on-created.subscription.ts';

export const contract = defineContract({
  name: 'billing-service',
  groups: [invoicesGroup],
  subscriptions: [draftInvoiceOnCreated],
  dependencies: [ordersDeps],
  definitions: [orgDefinitions],
});
