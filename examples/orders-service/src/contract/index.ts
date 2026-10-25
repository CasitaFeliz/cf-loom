import { defineContract } from '@cf-loom/contract';
import { definitions as orgDefinitions } from '@org/definitions';
import { infrastructureGroup } from './groups/infrastructure.group.ts';
import { ordersGroup } from './groups/orders.group.ts';

export const contract = defineContract({
  name: 'orders-service',
  groups: [ordersGroup, infrastructureGroup],
  standardRejections: orgDefinitions,
});
