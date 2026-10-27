import type { ServiceContract } from '@cf-loom/contract';
import { connectedMessaging, type MessagingOptions } from '../messaging/index.ts';
import { serviceVersionsOf, subjectsOf } from '../subjects/index.ts';
import { injectedAttemptsOf } from './attempts.ts';
import { MemoryConnection } from './connection.ts';
import { Deliveries } from './deliveries.ts';
import { recordedOf } from './recorded.ts';
import type { MemoryMessaging } from './types.ts';

/**
 * Runs a Contract's messaging in memory, for tests and local development: no Broker, Messages
 * delivered one at a time in publish order, none of the organization's broker configuration
 * modeled. Resolves to its `Messaging` and what a test drives and watches it with.
 */
export async function memory<const C extends ServiceContract>(
  contract: C,
  options: MessagingOptions = {},
): Promise<MemoryMessaging<C>> {
  const subjects = subjectsOf(contract);
  const versions = serviceVersionsOf(subjects);
  const deliveries = new Deliveries();
  const connection = new MemoryConnection(deliveries);
  return {
    ...connectedMessaging<C>(subjects, connection, options),
    settled: () => deliveries.settled(),
    get messages() {
      return connection.messages();
    },
    messagesOf: (message) => recordedOf(connection.messages(), versions, message),
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
