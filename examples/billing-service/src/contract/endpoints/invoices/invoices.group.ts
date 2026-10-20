import { defineGroup } from '@casitafeliz/loom-contract';
import { createInvoice } from './create-invoice.endpoint.ts';

export const invoicesGroup = defineGroup({
  name: 'invoices',
  description: 'Invoices for paid orders',
  endpoints: [createInvoice],
});
