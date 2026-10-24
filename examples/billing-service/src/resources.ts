import type { WithResources } from '@cf-loom/handlers';
import type { OrdersClient } from './orders-client/orders-client.ts';

/** What this Service's Handlers reach outside its Contract: its client of orders-service. */
export type Resources = {
  readonly orders: OrdersClient;
};

/** The Resources a Handler takes, picked by key from the Service's. */
export type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;
