import { defineContract } from '@casitafeliz/loom-contract';
import { operationsGroup } from './endpoints/operations/operations.group.ts';
import { ordersGroup } from './endpoints/orders/orders.group.ts';

export const contract = defineContract({
  name: 'orders-service',
  groups: [ordersGroup, operationsGroup],
});
