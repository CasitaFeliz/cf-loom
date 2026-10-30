import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Broker, messaging } from '@cf-loom/messaging';
import { serve } from '@cf-loom/server';
import { nodeHttp } from '@cf-loom/server/node-http';
import { contract as ordersContract } from '../../orders-service/src/contract/index.ts';
import ordersHandlers from '../../orders-service/src/handlers.generated.ts';
import type { Resources as OrdersResources } from '../../orders-service/src/resources.ts';
import { contract } from '../src/contract/index.ts';
import handlers from '../src/generated/handlers.generated.ts';
import { ordersClientOf } from '../src/orders-client/orders-client.ts';
import type { Resources } from '../src/resources.ts';

/** A Service the test runs in its own process: where it answers HTTP, and how it stops. */
export type RunningService = {
  readonly url: string;
  readonly close: () => Promise<void>;
};

/** The URL of the free local port `server` listens on, once it does. */
async function listeningUrl(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** orders-service over `broker`, built from its Contract, Handler map and Resources, listening on a free local port. */
export async function ordersOver(broker: Broker): Promise<RunningService> {
  const running = await messaging(ordersContract, broker);
  const resources: OrdersResources = { publisher: running.publisher, sender: running.sender };
  const server = nodeHttp(serve(ordersContract, ordersHandlers, { resources }));
  const url = await listeningUrl(server);
  await running.consume(ordersHandlers, { resources });
  return {
    url,
    close: async () => {
      server.close();
      await running.close();
    },
  };
}

/** billing-service over `broker`, built from its Contract, Handler map and Resources, calling orders-service at `ordersUrl`. */
export async function billingOver(broker: Broker, ordersUrl: string): Promise<RunningService> {
  const resources: Resources = { orders: ordersClientOf(ordersUrl, 'billing-key') };
  const running = await messaging(contract, broker);
  const server = nodeHttp(serve(contract, handlers, { resources }));
  const url = await listeningUrl(server);
  await running.consume(handlers, {});
  return {
    url,
    close: async () => {
      server.close();
      await running.close();
    },
  };
}
