import type { AddressInfo } from 'node:net';
import { messaging } from '@cf-loom/messaging';
import { jetstream } from '@cf-loom/messaging/jetstream';
import { serve } from '@cf-loom/server';
import { nodeHttp } from '@cf-loom/server/node-http';
import { connect } from '@nats-io/transport-node';
import { contract } from './contract/index.ts';
import { environmentValue } from './environment/environment.ts';
import handlers from './generated/handlers.generated.ts';
import { ordersClientOf } from './orders-client/orders-client.ts';
import type { Resources } from './resources.ts';

const orders = ordersClientOf(
  environmentValue('ORDERS_SERVICE_URL'),
  environmentValue('ORDERS_SERVICE_API_KEY'),
);
const resources: Resources = { orders };
const natsUrl = environmentValue('NATS_URL');
const running = await messaging(
  contract,
  jetstream({ connect: () => connect({ servers: natsUrl }), prefix: process.env['BROKER_PREFIX'] }),
);
const http = serve(contract, handlers, { resources });
const server = nodeHttp(http).listen(Number(process.env['PORT'] ?? 3000), () => {
  const { port } = server.address() as AddressInfo;
  console.log(`billing-service listening on ${port}`);
});

process.on('SIGTERM', () => {
  server.close();
  void running.close();
});
await running.consume(handlers, {});
