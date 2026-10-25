import { defineDependency } from '@cf-loom/contract';
import { contract as orders } from '@org/contract-orders-service';

export const ordersDependency = defineDependency({
  provider: orders,
  endpoints: [orders.endpoints.getOrder],
});
