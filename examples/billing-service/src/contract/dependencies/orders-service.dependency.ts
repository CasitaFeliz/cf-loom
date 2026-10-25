import { defineDependencies } from '@cf-loom/contract';
import { contract as orders } from '@org/contract-orders-service';

export const ordersDeps = defineDependencies(orders, {
  endpoints: [orders.endpoints.getOrder],
  events: [orders.events.orderCreatedV1],
});
