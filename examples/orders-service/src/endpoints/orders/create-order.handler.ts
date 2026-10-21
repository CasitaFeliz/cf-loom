import { randomUUID } from 'node:crypto';
import { handle, success } from '@cf-loom/handlers';
import { createOrder } from '../../contract/endpoints/orders/create-order.endpoint.ts';
import { ordersMessaging } from '../../messaging.ts';

export default handle(createOrder, async ({ body }) => {
  const placedAt = new Date().toISOString();
  const order = { id: randomUUID(), status: 'pending', placedAt, ...body } as const;
  const { publisher } = ordersMessaging();
  const created = { orderId: order.id, customerId: order.customerId, total: order.total };
  await publisher.publish('OrderCreated', { v1: created }, { factId: `${order.id}:created` });
  return success(order);
});
