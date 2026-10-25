import type { Contract } from '@cf-loom/contract';
import type { ResourcesOf } from '@cf-loom/handlers';
import type { CallArgument, NoResources, ResourcesField } from '@cf-loom/handlers/internal';
import type { Broker, BrokerService } from '../broker/index.ts';
import {
  type BrokerTroubleHook,
  type ConsumedHandlers,
  consumersOf,
  reportOf,
  type ServiceFaultHook,
  troubleReportOf,
} from '../consuming/index.ts';
import { type CommandSender, type EventPublisher, publishOf, sendOf } from '../sending/index.ts';
import { type Subjects, subjectsOf } from '../subjects/index.ts';
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

/** One connection's messaging, which `messaging()` resolves to: publishing, sending and consuming until it is closed. */
export type Messaging<C extends Contract> = {
  readonly publisher: EventPublisher<C>;
  readonly sender: CommandSender<C>;
  readonly consume: <Handlers extends ConsumedHandlers>(
    handlers: Handlers,
    ...options: CallArgument<
      ConsumeOptions<ResourcesOf<Pick<Handlers, 'commands' | 'subscriptions'>>>
    >
  ) => Promise<void>;
  readonly close: () => Promise<void>;
};

/** Connects a Contract's messaging through a broker, so it publishes, sends and consumes the Contract's Messages. */
export async function messaging<const C extends Contract>(
  contract: C,
  broker: Broker,
  options: MessagingOptions = {},
): Promise<Messaging<C>> {
  const subjects = subjectsOf(contract);
  const life = new MessagingLife(await broker.connect(brokerServiceOf(subjects)));
  const connectionOf = () => life.connectionOf();
  const publish = publishOf(subjects, connectionOf);
  const send = sendOf(subjects, connectionOf);
  const report = reportOf(options.onServiceFault);
  const troubleReport = troubleReportOf(options.onBrokerTrouble);
  return {
    publisher: { publish: (...call: Parameters<typeof publish>) => life.tracked(publish(...call)) },
    sender: { send: (...call: Parameters<typeof send>) => life.tracked(send(...call)) },
    consume: (handlers: ConsumedHandlers, { resources }: ConsumeOptions<object> = {}) =>
      life.consume(
        (received) => consumersOf(subjects.consumed, handlers, { report, resources, received }),
        troubleReport,
      ),
    close: () => life.close(),
  };
}

function brokerServiceOf(subjects: Subjects): BrokerService {
  const versions = [...subjects.published, ...subjects.sent];
  return {
    stream: subjects.stream,
    subjects: versions.map((version) => version.subject),
  };
}
