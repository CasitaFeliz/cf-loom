import type { AddressInfo } from 'node:net';
import { memory } from '@cf-loom/messaging/memory';
import { serve } from '@cf-loom/server';
import { nodeHttp } from '@cf-loom/server/node-http';
import { contract } from './contract/index.ts';
import handlers from './handlers.generated.ts';
import { startMessaging } from './messaging.ts';

// TODO(#77): start messaging with jetstream() once the adapter exists.
const running = await startMessaging(memory());
const http = serve(contract, handlers);
const server = nodeHttp(http).listen(Number(process.env['PORT'] ?? 3000), () => {
  const { port } = server.address() as AddressInfo;
  console.log(`orders-service listening on ${port}`);
});
await running.consume(handlers);

process.on('SIGTERM', () => {
  server.close();
  void running.close();
});
