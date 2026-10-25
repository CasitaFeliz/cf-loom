import { defineGroup } from '@cf-loom/contract';
import { createOrder } from './create-order.endpoint.ts';
import { getOrder } from './get-order.endpoint.ts';

export const ordersGroup = defineGroup({
  name: 'orders',
  description: 'Order lifecycle',
  endpoints: [getOrder, createOrder],
});
