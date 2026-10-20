import type { Contract } from '@cf-loom/contract';
import type { Broker, ConsumedFault } from '../broker/index.ts';
import { type ConsumedHandlers, consumersOf, reportOf } from '../consuming/index.ts';
import { routesOf } from '../routing/index.ts';
import { type CommandSender, type EventPublisher, publishOf, sendOf } from '../sending/index.ts';
import { Connection } from './connection.ts';

/** What is operational about messaging and no part of the Contract: the hook for what Message Handlers end or fail with. */
export type MessagingOptions = {
  /** Receives a Message ended for failing its schema, a Fault with `retryable: false`, and anything thrown; the console without it. */
  readonly onServiceFault?: (fault: ConsumedFault) => void;
};

/** What `messaging()` returns: created once per Service, connected with a broker, consuming its Handler map. */
export type Messaging<C extends Contract> = {
  readonly publisher: EventPublisher<C>;
  readonly sender: CommandSender<C>;
  readonly consume: (handlers: ConsumedHandlers) => Promise<void>;
  readonly connect: (broker: Broker) => Promise<void>;
  readonly close: () => Promise<void>;
};

/** Publishes, sends and consumes a Contract's Messages; it opens no connection until `connect`. */
export function messaging<const C extends Contract>(
  contract: C,
  options: MessagingOptions = {},
): Messaging<C> {
  const routes = routesOf(contract);
  const connection = new Connection();
  const sending = () => connection.sending();
  const report = reportOf(options.onServiceFault);
  return {
    publisher: { publish: publishOf(routes, sending) },
    sender: { send: sendOf(routes, sending) },
    consume: (handlers) => connection.consume(() => consumersOf(routes.consumed, handlers, report)),
    connect: (broker) => connection.connect(broker, { name: routes.service }),
    close: () => connection.close(),
  };
}
