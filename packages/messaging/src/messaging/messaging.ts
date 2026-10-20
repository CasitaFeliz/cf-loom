import type { Contract } from '@cf-loom/contract';
import type { Broker, ConsumedFault } from '../broker/index.ts';
import { type ConsumedHandlers, consumersOf, reportOf } from '../consuming/index.ts';
import { type CommandSender, type EventPublisher, publishOf, sendOf } from '../sending/index.ts';
import { subjectsOf } from '../subjects/index.ts';
import { MessagingLife } from './life.ts';

/** What is operational about messaging and no part of the Contract: the hook for what Message Handlers end or fail with. */
export type MessagingOptions = {
  /** Receives a Message ended for failing its schema, a Fault with `retryable: false`, and anything thrown; the console without it. */
  readonly onServiceFault?: (fault: ConsumedFault) => void;
};

/** One connection's messaging, which `messaging()` resolves to: publishing, sending and consuming until it is closed. */
export type Messaging<C extends Contract> = {
  readonly publisher: EventPublisher<C>;
  readonly sender: CommandSender<C>;
  readonly consume: (handlers: ConsumedHandlers) => Promise<void>;
  readonly close: () => Promise<void>;
};

/** Connects a Contract's messaging through a broker, so it publishes, sends and consumes the Contract's Messages. */
export async function messaging<const C extends Contract>(
  contract: C,
  broker: Broker,
  options: MessagingOptions = {},
): Promise<Messaging<C>> {
  const subjects = subjectsOf(contract);
  const life = new MessagingLife(await broker.connect({ name: subjects.service }));
  const sending = () => life.sending();
  const report = reportOf(options.onServiceFault);
  return {
    publisher: { publish: publishOf(subjects, sending) },
    sender: { send: sendOf(subjects, sending) },
    consume: (handlers) => life.consume(() => consumersOf(subjects.consumed, handlers, report)),
    close: () => life.close(),
  };
}
