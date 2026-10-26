import { defineDependency } from '@cf-loom/contract';
import { getOrderEndpoint } from '@org/contract-orders-service';

export const ordersDependency = defineDependency({ endpoints: [getOrderEndpoint] });
