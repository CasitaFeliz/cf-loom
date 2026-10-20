import { defineContract } from '@cf-loom/contract';
import { definitions as orgDefinitions } from '@org/definitions';
import { infrastructureGroup } from './endpoints/infrastructure/infrastructure.group.ts';
import { ordersGroup } from './endpoints/orders/orders.group.ts';

export const contract = defineContract({
  name: 'orders-service',
  groups: [ordersGroup, infrastructureGroup],
  definitions: [orgDefinitions],
});
