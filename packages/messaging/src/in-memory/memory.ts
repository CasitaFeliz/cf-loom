import type { BrokerService } from '../broker/index.ts';
import { injectedAttemptsOf } from './attempts.ts';
import { MemoryConnection } from './connection.ts';
import { Deliveries } from './deliveries.ts';
import { recordedOf } from './recorded.ts';
import type { MemoryBroker } from './types.ts';

/**
 * A Broker kept in memory, for tests and local development: it serves one connection, delivers one
 * Message at a time and models none of the organization's broker configuration.
 */
export function memory(): MemoryBroker {
  const deliveries = new Deliveries();
  const connection = new MemoryConnection(deliveries);
  let connectedService: BrokerService | undefined;
  return {
    connect: async (service) => {
      if (connectedService !== undefined) {
        throw new Error(
          'memory() serves one connection: create another memory() for another messaging()',
        );
      }
      connectedService = service;
      return connection;
    },
    settled: () => deliveries.settled(),
    get messages() {
      return connection.messages();
    },
    messagesOf: (message) => recordedOf(connection.messages(), connectedService, message),
    deliver: async (message, body, meta = {}) => {
      connection.assertOpen();
      const attempts = injectedAttemptsOf(connection.consumers(), { message, body, meta });
      return await deliveries.lineUpAndWait(attempts);
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
