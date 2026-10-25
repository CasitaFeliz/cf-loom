import { defineGroup } from '@cf-loom/contract';
import { chargeCardV1 } from '../commands/orders/charge-card.v1.command.ts';
import { createOrder } from '../endpoints/orders/create-order.endpoint.ts';
import { getOrder } from '../endpoints/orders/get-order.endpoint.ts';
import { orderCreatedV1 } from '../events/orders/order-created.v1.event.ts';
import { chargeOnCreated } from '../subscriptions/orders/charge-on-created.subscription.ts';

export const ordersGroup = defineGroup({
  name: 'orders',
  description: 'Order lifecycle',
  endpoints: [getOrder, createOrder],
  events: [orderCreatedV1],
  commands: [chargeCardV1],
  subscriptions: [chargeOnCreated],
});
