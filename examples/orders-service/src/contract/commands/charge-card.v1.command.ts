import { defineCommand } from '@cf-loom/contract';
import { money } from '@org/definitions';
import { z } from 'zod';

export const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the customer’s card for an order’s total',
  body: z.object({ orderId: z.uuid(), total: money }),
});
