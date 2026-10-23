import type { NatsConnection } from '@nats-io/nats-core';

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
