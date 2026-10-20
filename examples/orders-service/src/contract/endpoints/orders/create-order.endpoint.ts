import { defineEndpoint } from '@cf-loom/contract';
import { z } from 'zod';
import { apiKey } from '../../guards/api-key.guard.ts';
import { money, order } from '../../schemas/order.schema.ts';

export const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'Places a pending order',
  guards: [apiKey],
  input: {
    body: z.object({ customerId: z.uuid(), total: money }),
  },
  success: { status: 201, body: order },
});
