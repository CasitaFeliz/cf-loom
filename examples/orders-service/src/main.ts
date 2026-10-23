import type { AddressInfo } from 'node:net';
import { jetstream } from '@cf-loom/messaging/jetstream';
import { serve } from '@cf-loom/server';
import { nodeHttp } from '@cf-loom/server/node-http';
import { connect } from '@nats-io/transport-node';
import { contract } from './contract/index.ts';
import handlers from './handlers.generated.ts';
import { startMessaging } from './messaging.ts';

/** A setting the Service cannot start without, read from the environment and refused by name when it is not set or is empty. */
function environmentValue(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set or empty`);
  return value;
}

const natsUrl = environmentValue('NATS_URL');
const running = await startMessaging(
  jetstream({ connect: () => connect({ servers: natsUrl }), prefix: process.env['BROKER_PREFIX'] }),
);
const http = serve(contract, handlers);
const server = nodeHttp(http).listen(Number(process.env['PORT'] ?? 3000), () => {
  const { port } = server.address() as AddressInfo;
  console.log(`orders-service listening on ${port}`);
});

process.on('SIGTERM', () => {
  server.close();
  void running.close();
});
await running.consume(handlers);
