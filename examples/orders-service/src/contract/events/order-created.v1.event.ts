import { defineEvent } from '@cf-loom/contract';
import { money } from '@org/definitions';
import { z } from 'zod';

export const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed, pending, for its total',
  body: z.object({ orderId: z.uuid(), customerId: z.uuid(), total: money }),
});
