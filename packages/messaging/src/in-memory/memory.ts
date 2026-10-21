import { attemptsOf, reachedBy } from './attempts.ts';
import { MemoryConnection } from './connection.ts';
import { Deliveries } from './deliveries.ts';
import type { MemoryBroker } from './types.ts';

/**
 * A Broker kept in memory, for tests and local development: it serves one connection, delivers one
 * Message at a time and models none of the organization's broker configuration.
 */
export function memory(): MemoryBroker {
  const deliveries = new Deliveries();
  const connection = new MemoryConnection(deliveries);
  let connected = false;
  return {
    connect: async () => {
      if (connected) {
        throw new Error(
          'memory() serves one connection: create another memory() for another messaging()',
        );
      }
      connected = true;
      return connection;
    },
    settled: () => deliveries.settled(),
    get messages() {
      return connection.messages();
    },
    deliver: async (message, body, meta = {}) => {
      connection.assertOpen();
      const reached = reachedBy(connection.consumers(), message);
      return await deliveries.lineUpTogether(attemptsOf(reached, { message, body, meta }));
    },
    redeliver: async () => {
      connection.assertOpen();
      await deliveries.redeliver();
    },
    get pending() {
      return deliveries.pending();
    },
  };
}
