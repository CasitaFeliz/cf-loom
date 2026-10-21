import type { AddressInfo } from 'node:net';
import { memory } from '@cf-loom/messaging/memory';
import { serve } from '@cf-loom/server';
import { nodeHttp } from '@cf-loom/server/node-http';
import { contract } from './contract/index.ts';
import handlers from './handlers.generated.ts';
import { startMessaging } from './messaging.ts';

/** In memory until the JetStream adapter replaces it (https://github.com/CasitaFeliz/cf-loom/issues/77). */
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
