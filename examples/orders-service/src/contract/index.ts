import { defineContract } from '@cf-loom/contract';
import { definitions as orgDefinitions } from '@org/definitions';
import { chargeCardV1 } from './commands/charge-card.v1.command.ts';
import { infrastructureGroup } from './endpoints/infrastructure/infrastructure.group.ts';
import { ordersGroup } from './endpoints/orders/orders.group.ts';
import { orderCreatedV1 } from './events/order-created.v1.event.ts';
import { chargeOnCreated } from './subscriptions/charge-on-created.subscription.ts';

export const contract = defineContract({
  name: 'orders-service',
  groups: [ordersGroup, infrastructureGroup],
  events: [orderCreatedV1],
  commands: [chargeCardV1],
  subscriptions: [chargeOnCreated],
  definitions: [orgDefinitions],
});
