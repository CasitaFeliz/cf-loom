import { client } from '@cf-loom/client';
import { defineApplication, defineDependency } from '@cf-loom/contract';
import { createOrderEndpoint } from '@org/contract-orders-service';

/** A browser Application's Dependency on the one Endpoint it calls of orders-service. */
const ordersDependency = defineDependency({ endpoints: [createOrderEndpoint] });

/** The Application's Contract, which holds only its Dependency. */
export const application = defineApplication({
  name: 'web-shop',
  dependencies: [ordersDependency],
});

/** The client a browser bundles: one method, `createOrder`. */
export const orders = client(ordersDependency, { baseUrl: 'https://orders.example' });
