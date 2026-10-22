import { once } from 'node:events';
import { createServer } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import type { Address } from './fake-registry.ts';

/** An address with nothing listening on it, and the way to give it back. */
export type DeadAddress = Address & { readonly release: () => void };

/** A host and port that were taken, so no other test is given them, with nothing listening on them. */
export async function aDeadAddress(): Promise<DeadAddress> {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const holder = connect({ host: '127.0.0.1', port: (listener.address() as AddressInfo).port });
  await once(holder, 'connect');
  const host = `127.0.0.1:${holder.localPort}`;
  return {
    url: `http://${host}`,
    host,
    release: () => {
      holder.destroy();
      listener.close();
    },
  };
}
