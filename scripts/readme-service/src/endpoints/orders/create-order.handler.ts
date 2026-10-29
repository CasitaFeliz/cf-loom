import { handle, success } from '@cf-loom/handlers';
import { createOrder } from '../../contract/endpoints/orders/create-order.endpoint.ts';
import type { Needs } from '../../resources.ts';

export default handle(
  createOrder,
  async ({ body }, _call, { resources: { publisher, sender } }: Needs<'publisher' | 'sender'>) => {
    const orderId = crypto.randomUUID();
    await publisher.publish(
      'OrderCreated',
      { v1: { orderId, total: body.total.amount }, v2: { orderId, total: body.total } },
      { factId: `${orderId}:created` },
    );
    await sender.send('ChargeCard', { orderId }, { factId: `${orderId}:charge` });
    return success({ id: orderId });
  },
);
