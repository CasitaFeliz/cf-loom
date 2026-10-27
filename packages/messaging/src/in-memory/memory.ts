import type { ServiceContract } from '@cf-loom/contract';
import type { DeclaredFieldsRule } from '@cf-loom/contract/internal';
import { connectedMessaging, type MessagingOptions } from '../messaging/index.ts';
import { serviceVersionsOf, subjectsOf } from '../subjects/index.ts';
import { injectedAttemptsOf } from './attempts.ts';
import { MemoryConnection } from './connection.ts';
import { Deliveries } from './deliveries.ts';
import { recordedOf } from './recorded.ts';
import type { MemoryMessaging } from './types.ts';

/**
 * Runs a Contract's messaging in memory, for tests: no Broker, Messages delivered one at a time in
 * publish order, and only while the test waits for `settled()`, `deliver()` or `redeliver()`, the
 * last two through their own Messages, none of the organization's broker configuration modeled.
 * Resolves to its `Messaging` and what a test drives and watches it with.
 */
export function memory<const C extends ServiceContract, const Given = unknown>(
  contract: C,
  options?: MessagingOptions & Given & NoInfer<DeclaredFieldsRule<Given, MessagingOptions>>,
): Promise<MemoryMessaging<C>>;
export async function memory(
  contract: ServiceContract,
  options: MessagingOptions = {},
): Promise<MemoryMessaging<ServiceContract>> {
  const subjects = subjectsOf(contract);
  const versions = serviceVersionsOf(subjects);
  const deliveries = new Deliveries();
  const connection = new MemoryConnection(deliveries);
  return {
    ...connectedMessaging(subjects, connection, options),
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
