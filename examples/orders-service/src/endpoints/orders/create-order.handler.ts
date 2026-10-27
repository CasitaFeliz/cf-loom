import { randomUUID } from 'node:crypto';
import { handle, success } from '@cf-loom/handlers';
import { createOrder } from '../../contract/endpoints/orders/create-order.endpoint.ts';
import type { Needs } from '../../resources.ts';

export default handle(
  createOrder,
  async ({ body }, _call, { resources: { publisher } }: Needs<'publisher'>) => {
    const placedAt = new Date().toISOString();
    const order = { id: randomUUID(), status: 'pending', placedAt, ...body } as const;
    const created = { orderId: order.id, customerId: order.customerId, total: order.total };
    await publisher.publish('OrderCreated', { v1: created }, { factId: `${order.id}:created` });
    return success(order);
  },
);
