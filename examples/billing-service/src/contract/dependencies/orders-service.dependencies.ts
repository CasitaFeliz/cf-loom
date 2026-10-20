import { defineDependencies } from '@casitafeliz/loom-contract';
import { contract as orders } from '@org/contract-orders-service';

export const ordersDeps = defineDependencies(orders, {
  endpoints: [orders.endpoints.getOrder],
});
