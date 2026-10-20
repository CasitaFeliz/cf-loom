import { defineRejection } from '@cf-loom/contract';
import { z } from 'zod';

export const orderNotBillable = defineRejection({
  code: 'ORDER_NOT_BILLABLE',
  status: 409,
  message: 'Only a paid order can be billed',
  body: z.object({ orderStatus: z.string() }),
});
