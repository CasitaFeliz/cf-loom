import { connect, createServer, type Server, type Socket } from 'node:net';

/** A TCP proxy in front of a test NATS server that can hold back what the server sends its clients, so a test decides when a Message the server already sent reaches one. */
export type HoldingProxy = {
  readonly url: string;
  /** From now on, what the server sends through the proxy waits until `release`. */
  readonly hold: () => void;
  /** Passes on what was held, and everything the server sends from now on. */
  readonly release: () => void;
  /** Closes every open connection through the proxy cleanly, what was held lost, and stops holding; it keeps listening, so a client that reconnects gets through. */
  readonly drop: () => void;
  readonly stop: () => Promise<void>;
};

type Link = { readonly client: Socket; readonly held: Buffer[] };

/** Starts a proxy on a random local port to the test server at `upstreamUrl`; never a fixed port or another NATS. */
export async function aHoldingProxy(upstreamUrl: string): Promise<HoldingProxy> {
  const upstream = new URL(upstreamUrl);
  const links: Link[] = [];
  let holding = false;
  const server = createServer((client) => {
    links.push(linkedToUpstream(client, upstream, () => holding));
  });
  await listening(server);
  const release = () => {
    holding = false;
    for (const link of links) {
      link.client.write(Buffer.concat(link.held.splice(0)));
    }
  };
  const drop = () => {
    holding = false;
    for (const link of links.splice(0)) {
      link.client.end();
    }
  };
  return {
    url: `nats://127.0.0.1:${(server.address() as { port: number }).port}`,
    hold: () => {
      holding = true;
    },
    release,
    drop,
    stop: async () => {
      for (const link of links) {
        link.client.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Passes what the client sends to the upstream server, and what the server sends back unless the proxy is holding it. */
function linkedToUpstream(client: Socket, upstream: URL, isHolding: () => boolean): Link {
  const toServer = connect({ host: upstream.hostname, port: Number(upstream.port) });
  const link: Link = { client, held: [] };
  client.on('data', (chunk) => toServer.write(chunk));
  toServer.on('data', (chunk) => (isHolding() ? link.held.push(chunk) : client.write(chunk)));
  client.on('close', () => toServer.destroy());
  toServer.on('close', () => client.destroy());
  client.on('error', () => toServer.destroy());
  toServer.on('error', () => client.destroy());
  return link;
}

function listening(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
}
