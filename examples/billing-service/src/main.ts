import type { AddressInfo } from 'node:net';
import { serve } from '@cf-loom/server';
import { nodeHttp } from '@cf-loom/server/node-http';
import { contract } from './contract/index.ts';
import handlers from './handlers.generated.ts';
import { ordersClient } from './orders-client/orders-client.ts';

ordersClient();
const http = serve(contract, handlers);
const server = nodeHttp(http).listen(Number(process.env['PORT'] ?? 3000), () => {
  const { port } = server.address() as AddressInfo;
  console.log(`billing-service listening on ${port}`);
});

process.on('SIGTERM', () => {
  server.close();
});
