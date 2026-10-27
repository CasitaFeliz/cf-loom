import type { ServiceContract } from '@cf-loom/contract';
import type { DeclaredFieldsRule } from '@cf-loom/contract/internal';
import type { Broker, BrokerConnection } from '../broker/index.ts';
import { brokerConsumerOf } from '../consuming/index.ts';
import { brokerServiceOf, subjectsOf } from '../subjects/index.ts';
import { connectedMessaging, type Messaging, type MessagingOptions } from './core.ts';
import type { CoreConnection } from './life.ts';

/** Connects a Contract's messaging through a broker, so it publishes, sends and consumes the Contract's Messages. */
export function messaging<const C extends ServiceContract, const Given = unknown>(
  contract: C,
  broker: Broker,
  options?: MessagingOptions & Given & NoInfer<DeclaredFieldsRule<Given, MessagingOptions>>,
): Promise<Messaging<C>>;
export async function messaging(
  contract: ServiceContract,
  broker: Broker,
  options: MessagingOptions = {},
): Promise<Messaging<ServiceContract>> {
  const subjects = subjectsOf(contract);
  const connection = await broker.connect(brokerServiceOf(subjects));
  return connectedMessaging(subjects, coreConnectionOf(connection), options);
}

/** The connection the core runs a Broker's connection as, handing it each consumer as an adapter takes it. */
function coreConnectionOf(connection: BrokerConnection): CoreConnection {
  return {
    publish: (message) => connection.publish(message),
    consume: (consumers, run) => connection.consume(consumers.map(brokerConsumerOf), run),
    close: () => connection.close(),
  };
}
