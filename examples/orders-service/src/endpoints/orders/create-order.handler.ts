import { randomUUID } from 'node:crypto';
import { handle, success } from '@cf-loom/handlers';
import { createOrder } from '../../contract/endpoints/orders/create-order.endpoint.ts';

export default handle(createOrder, async ({ body }) => {
  const placedAt = new Date().toISOString();
  return success({ id: randomUUID(), status: 'pending', placedAt, ...body });
});
