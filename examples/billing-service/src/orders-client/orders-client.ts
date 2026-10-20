import { type Client, client } from '@casitafeliz/loom-client';
import { ordersDeps } from '../contract/dependencies/orders-service.dependencies.ts';

/** A client of orders-service that already sends billing's API key. */
export type OrdersClient = Client<typeof ordersDeps, 'x-api-key'>;

let cached: OrdersClient | undefined;

/**
 * The one client of orders-service, built on first use where the environment says it runs, so
 * `main.ts` builds it at boot and a missing setting fails there.
 */
export function ordersClient(): OrdersClient {
  cached ??= client(ordersDeps, {
    baseUrl: environmentValue('ORDERS_SERVICE_URL'),
    headers: { 'x-api-key': environmentValue('ORDERS_SERVICE_API_KEY') },
  });
  return cached;
}

function environmentValue(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}
