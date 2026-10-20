import { defineEndpoint, notFound } from '@cf-loom/contract';
import { money } from '@org/definitions';
import { z } from 'zod';
import { orderLocked } from '../../rejections/order-locked.rejection.ts';
import { orderNotBillable } from '../../rejections/order-not-billable.rejection.ts';

export const createInvoice = defineEndpoint({
  name: 'createInvoice',
  method: 'POST',
  path: '/invoices',
  visibility: 'internal',
  description: 'Bills a paid order for its total',
  input: {
    body: z.object({ orderId: z.uuid() }),
  },
  success: {
    status: 201,
    body: z.object({
      id: z.uuid(),
      orderId: z.uuid(),
      total: money,
    }),
  },
  rejections: [notFound, orderLocked, orderNotBillable],
});
