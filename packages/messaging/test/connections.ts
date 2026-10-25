import type { NatsConnection } from '@nats-io/nats-core';
import type { NatsServer } from './nats-server.ts';

/** A NATS connection with some of its methods replaced, for a test that makes the NATS client fail or watches what it is asked. */
export function withMethods(
  connection: NatsConnection,
  replaced: Partial<NatsConnection>,
): NatsConnection {
  return new Proxy(connection, {
    get(target, property) {
      if (property in replaced) {
        return Reflect.get(replaced, property);
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Stops a test's own server, and resolves once the connection's NATS client noticed it went away. */
export async function stopServerUnder(
  connection: NatsConnection,
  server: NatsServer,
): Promise<void> {
  const statuses = connection.status();
  const noticed = (async () => {
    for await (const status of statuses) {
      if (status.type === 'disconnect') {
        return;
      }
    }
  })();
  await server.stop();
  await noticed;
}
