import type { ServiceContract } from '@cf-loom/contract';
import type { DeclaredFieldsRule } from '@cf-loom/contract/internal';
import type { HandlerMapOf, ResourcesOf } from '@cf-loom/handlers';
import type { CallArgument, NoResources, ResourcesField } from '@cf-loom/handlers/internal';
import type { Broker } from '../broker/index.ts';
import {
  type BrokerTroubleHook,
  type ConsumedHandlers,
  consumersOf,
  reportOf,
  type ServiceFaultHook,
  troubleTellOf,
} from '../consuming/index.ts';
import { type CommandSender, type EventPublisher, publishOf, sendOf } from '../sending/index.ts';
import { brokerServiceOf, subjectsOf } from '../subjects/index.ts';
import type { CloseOptions } from './closed.ts';
import { MessagingLife } from './life.ts';

/** What is operational about messaging and no part of the Contract: the hooks for what Message Handlers end or fail with, and for durable consumers no longer pulled from. */
export type MessagingOptions = {
  /** Receives a Message ended for failing its schema, every Fault a Handler returned, retryable or not, and anything thrown; the console without it. */
  readonly onServiceFault?: ServiceFaultHook;
  /** Receives each durable consumer stopping being pulled from, and its pulls answered again, once each time; the console without it. */
  readonly onBrokerTrouble?: BrokerTroubleHook;
};

/** What `consume` takes besides the Handler map: the Resources its Message Handlers take. */
export type ConsumeOptions<Resources extends object = NoResources> = ResourcesField<Resources>;

/** The options `consume` takes for a Handler map: the Resources its Message Handlers take. */
type ConsumedOptionsOf<
  Handlers extends Pick<HandlerMapOf<ServiceContract>, 'commands' | 'subscriptions'>,
> = ConsumeOptions<ResourcesOf<Pick<Handlers, 'commands' | 'subscriptions'>>>;

/** One connection's messaging, which `messaging()` resolves to: publishing, sending and consuming until it is closed. */
export type Messaging<C extends ServiceContract> = {
  readonly publisher: EventPublisher<C>;
  readonly sender: CommandSender<C>;
  readonly consume: <
    const Handlers extends Pick<HandlerMapOf<C>, 'commands' | 'subscriptions' | 'readers'>,
    const Given extends ConsumedOptionsOf<Handlers> = ConsumedOptionsOf<Handlers>,
  >(
    handlers: Handlers,
    ...options: CallArgument<
      ConsumedOptionsOf<Handlers>,
      Given & NoInfer<DeclaredFieldsRule<Given, ConsumeOptions<object>>>
    >
  ) => Promise<void>;
  /** Stops consuming, waits for what is in flight and closes the connection; once `signal` aborts, it hands back each delivery still settling, closes, and rejects naming them. */
  readonly close: (options?: CloseOptions) => Promise<void>;
};

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
  const life = new MessagingLife(await broker.connect(brokerServiceOf(subjects)));
  const connectionOf = () => life.connectionOf();
  const publish = publishOf(subjects, connectionOf);
  const send = sendOf(subjects, connectionOf);
  const report = reportOf(options.onServiceFault);
  const tellTrouble = troubleTellOf(options.onBrokerTrouble);
  return {
    publisher: { publish: (...call: Parameters<typeof publish>) => life.tracked(publish(...call)) },
    sender: { send: (...call: Parameters<typeof send>) => life.tracked(send(...call)) },
    consume: (handlers: ConsumedHandlers, { resources }: ConsumeOptions<object> = {}) =>
      life.consume(
        (lived) => consumersOf(subjects.consumed, handlers, { report, resources, ...lived }),
        tellTrouble,
      ),
    close: (options?: CloseOptions) => life.close(options),
  };
}
