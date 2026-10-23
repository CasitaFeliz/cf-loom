import { connect, createServer, type Server, type Socket } from 'node:net';

/** A TCP proxy in front of a test NATS server that can hold back what the server sends its clients, so a test decides when a Message the server already sent reaches one. */
export type HoldingProxy = {
  readonly url: string;
  /** From now on, what the server sends through the proxy waits until `release`. */
  readonly hold: () => void;
  /** Passes on what was held, and everything the server sends from now on. */
  readonly release: () => void;
  readonly stop: () => Promise<void>;
};

type Link = { readonly client: Socket; readonly held: Buffer[] };

/** Starts a proxy on a random local port to the test server at `upstreamUrl`; never a fixed port or another NATS. */
export async function aHoldingProxy(upstreamUrl: string): Promise<HoldingProxy> {
  const upstream = new URL(upstreamUrl);
  const links: Link[] = [];
  let holding = false;
  const server = createServer((client) => {
    const link: Link = { client, held: [] };
    links.push(link);
    const toServer = connect({ host: upstream.hostname, port: Number(upstream.port) });
    client.on('data', (chunk) => toServer.write(chunk));
    toServer.on('data', (chunk) => (holding ? link.held.push(chunk) : client.write(chunk)));
    client.on('close', () => toServer.destroy());
    toServer.on('close', () => client.destroy());
    client.on('error', () => toServer.destroy());
    toServer.on('error', () => client.destroy());
  });
  await listening(server);
  const release = () => {
    holding = false;
    for (const link of links) {
      link.client.write(Buffer.concat(link.held.splice(0)));
    }
  };
  return {
    url: `nats://127.0.0.1:${(server.address() as { port: number }).port}`,
    hold: () => {
      holding = true;
    },
    release,
    stop: async () => {
      for (const link of links) {
        link.client.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function listening(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
}
