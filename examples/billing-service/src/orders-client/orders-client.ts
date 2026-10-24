import { type Client, client } from '@cf-loom/client';
import { ordersDeps } from '../contract/dependencies/orders-service.dependencies.ts';

/** A client of orders-service that already sends billing's API key. */
export type OrdersClient = Client<typeof ordersDeps, 'x-api-key'>;

/** A client of the orders-service at `baseUrl`, authenticated with billing's `apiKey`. */
export function ordersClientOf(baseUrl: string, apiKey: string): OrdersClient {
  return client(ordersDeps, { baseUrl, headers: { 'x-api-key': apiKey } });
}
