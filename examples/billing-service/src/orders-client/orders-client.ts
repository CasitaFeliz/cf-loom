import { type Client, client } from '@casitafeliz/loom-client';
import { ordersDeps } from '../contract/dependencies/orders-service.dependencies.ts';

/** A client of orders-service that already sends billing's API key. */
export type OrdersClient = Client<typeof ordersDeps, 'x-api-key'>;

/** The client of orders-service where the environment says it runs, with the key it gives. */
export function ordersClient(): OrdersClient {
  return client(ordersDeps, {
    baseUrl: environmentValue('ORDERS_SERVICE_URL'),
    headers: { 'x-api-key': environmentValue('ORDERS_SERVICE_API_KEY') },
  });
}

function environmentValue(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}
