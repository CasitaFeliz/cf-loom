import { defineGroup } from '@cf-loom/contract';
import { createInvoice } from '../endpoints/billing/create-invoice.endpoint.ts';
import { draftInvoiceOnCreated } from '../subscriptions/billing/draft-invoice-on-created.subscription.ts';

export const billingGroup = defineGroup({
  name: 'billing',
  description: 'Invoices for paid orders',
  endpoints: [createInvoice],
  subscriptions: [draftInvoiceOnCreated],
});
