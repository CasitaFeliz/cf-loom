import type { ServiceContract } from '@cf-loom/contract';
import type { HandlerMapOf, NoResources, ResourcesOf } from '@cf-loom/handlers';
import type { ResourcesField } from '@cf-loom/handlers/internal';
import {
  type BrokerTroubleHook,
  type ConsumedHandlers,
  consumersOf,
  reportOf,
  type ServiceFaultHook,
  troubleTellOf,
} from '../consuming/index.ts';
import { type CommandSender, type EventPublisher, publishOf, sendOf } from '../sending/index.ts';
import type { Subjects } from '../subjects/index.ts';
import type { CloseOptions } from './closed.ts';
import { type CoreConnection, MessagingLife } from './life.ts';

/** What is operational about messaging and no part of the Contract: the hooks for what Message Handlers end or fail with, and for durable consumers no longer pulled from. */
export type MessagingOptions = {
  /** Receives a Message ended for failing its schema, every Fault a Handler returned, retryable or not, and anything thrown; the console without it. */
  readonly onServiceFault?: ServiceFaultHook;
  /** Receives each durable consumer stopping being pulled from, and its pulls answered again, once each time; the console without it. */
  readonly onBrokerTrouble?: BrokerTroubleHook;
};

/** What `consume` takes besides the Handler map: the Resources its Message Handlers take. */
export type ConsumeOptions<Resources extends object = NoResources> = ResourcesField<Resources>;

/** One connection's messaging, which `messaging()` and `memory()` resolve to: publishing, sending and consuming until it is closed. */
export type Messaging<C extends ServiceContract> = {
  readonly publisher: EventPublisher<C>;
  readonly sender: CommandSender<C>;
  readonly consume: <
    const Handlers extends Pick<HandlerMapOf<C, never>, 'commands' | 'subscriptions' | 'readers'>,
  >(
    handlers: Handlers,
    options: ConsumeOptions<ResourcesOf<Pick<Handlers, 'commands' | 'subscriptions'>>>,
  ) => Promise<void>;
  /** Stops consuming, waits for what is in flight and closes the connection; once `signal` aborts, it hands back each delivery still settling, closes, and rejects naming them. */
  readonly close: (options?: CloseOptions) => Promise<void>;
};

/** A Contract's messaging over one connection of the core's own view, which `messaging()` builds over a Broker and `memory()` over its own. */
export function connectedMessaging<C extends ServiceContract>(
  subjects: Subjects,
  connection: CoreConnection,
  options: MessagingOptions,
): Messaging<C> {
  const life = new MessagingLife(connection);
  const connectionOf = () => life.connectionOf();
  const publish = publishOf(subjects, connectionOf);
  const send = sendOf(subjects, connectionOf);
  const report = reportOf(options.onServiceFault);
  const tellTrouble = troubleTellOf(options.onBrokerTrouble);
  return {
    publisher: { publish: (...call: Parameters<typeof publish>) => life.tracked(publish(...call)) },
    sender: { send: (...call: Parameters<typeof send>) => life.tracked(send(...call)) },
    consume: (handlers: ConsumedHandlers, { resources }: ConsumeOptions<object>) =>
      life.consume(
        (lived) => consumersOf(subjects.consumed, handlers, { report, resources, ...lived }),
        tellTrouble,
      ),
    close: (options?: CloseOptions) => life.close(options),
  };
}
