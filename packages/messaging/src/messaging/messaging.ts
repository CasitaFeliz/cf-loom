import type { ServiceContract } from '@cf-loom/contract';
import type { Closed } from '@cf-loom/contract/internal';
import type { Broker, BrokerConnection } from '../broker/index.ts';
import { durableConsumerOf } from '../consuming/index.ts';
import { serviceStreamOf, subjectsOf } from '../subjects/index.ts';
import { connectedMessaging, type Messaging, type MessagingOptions } from './core.ts';
import type { CoreConnection } from './life.ts';

/** Connects a Contract's messaging through a broker, so it publishes, sends and consumes the Contract's Messages. */
export function messaging<const C extends ServiceContract, const Given = unknown>(
  contract: C,
  broker: Broker,
  options?: Closed<Given, MessagingOptions>,
): Promise<Messaging<C>>;
export async function messaging(
  contract: ServiceContract,
  broker: Broker,
  options: MessagingOptions = {},
): Promise<Messaging<ServiceContract>> {
  const subjects = subjectsOf(contract);
  const connection = await broker.connect(serviceStreamOf(subjects));
  return connectedMessaging(subjects, coreConnectionOf(connection), options);
}

/** The connection the core runs a Broker's connection as, handing it each Durable consumer as an adapter takes it. */
function coreConnectionOf(connection: BrokerConnection): CoreConnection {
  return {
    publish: (message) => connection.publish(message),
    consume: (durableConsumers, run) =>
      connection.consume(durableConsumers.map(durableConsumerOf), run),
    close: () => connection.close(),
  };
}
