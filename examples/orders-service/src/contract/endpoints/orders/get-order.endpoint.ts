import { defineEndpoint, notFound } from '@casitafeliz/loom-contract';
import { z } from 'zod';
import { apiKey } from '../../guards/api-key.guard.ts';
import { orderLocked } from '../../rejections/order-locked.rejection.ts';
import { order } from '../../schemas/order.schema.ts';

export const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'internal',
  description: 'One order by id',
  guards: [apiKey],
  input: {
    params: z.object({ orderId: z.uuid() }),
  },
  success: { status: 200, body: order },
  rejections: [notFound, orderLocked],
});
