import { notFound } from '@cf-loom/contract';
import { handle, reject, success } from '@cf-loom/handlers';
import { getOrder } from '../../contract/endpoints/orders/get-order.endpoint.ts';
import { orderLocked } from '../../contract/rejections/order-locked.rejection.ts';
import { seededOrderOf } from '../../seeded-orders.ts';

export default handle(getOrder, async ({ params }) => {
  const order = seededOrderOf(params.orderId);
  if (order === undefined) return reject(notFound);
  if (order.lockedAt !== undefined) return reject(orderLocked, { lockedAt: order.lockedAt });
  return success(getOrder, order);
});
