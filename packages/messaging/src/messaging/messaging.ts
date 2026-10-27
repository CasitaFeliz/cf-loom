import type { ServiceContract } from '@cf-loom/contract';
import type { Broker, BrokerConnection } from '../broker/index.ts';
import { brokerConsumerOf } from '../consuming/index.ts';
import { brokerServiceOf, subjectsOf } from '../subjects/index.ts';
import { connectedMessaging, type Messaging, type MessagingOptions } from './core.ts';
import type { CoreConnection } from './life.ts';

/** Connects a Contract's messaging through a broker, so it publishes, sends and consumes the Contract's Messages. */
export async function messaging<const C extends ServiceContract>(
  contract: C,
  broker: Broker,
  options: MessagingOptions = {},
): Promise<Messaging<C>> {
  const subjects = subjectsOf(contract);
  const connection = await broker.connect(brokerServiceOf(subjects));
  return connectedMessaging<C>(subjects, coreConnectionOf(connection), options);
}

/** The connection the core runs a Broker's connection as, handing it each consumer as an adapter takes it. */
function coreConnectionOf(connection: BrokerConnection): CoreConnection {
  return {
    publish: (message) => connection.publish(message),
    consume: (consumers, run) => connection.consume(consumers.map(brokerConsumerOf), run),
    close: () => connection.close(),
  };
}
