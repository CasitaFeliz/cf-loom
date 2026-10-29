import { isLive, type Lifecycle } from '../declarations/index.ts';
import { durableNameOf, streamNameOf, subjectOf } from './broker.ts';

/** A Message Version of the Service's own, as the Broker routes it; a `lifecycle` left out is Active. */
export type RoutedMessage = {
  readonly kind: 'event' | 'command';
  readonly name: string;
  readonly version: number;
  readonly lifecycle?: Lifecycle | undefined;
};

/** A Subscription as the Broker routes it: its name, and the Provider and Event Version it reads. */
export type RoutedSubscription = {
  readonly name: string;
  readonly provider: string;
  readonly event: { readonly name: string; readonly version: number };
};

/** One Durable consumer a Service needs, unprefixed, with the Command Version or Subscription it is for. */
export type NeededDurableConsumer<From> = {
  readonly from: From;
  readonly durable: string;
  readonly stream: string;
  readonly subject: string;
};

/** The Command Versions among some Message Versions, with the type of each kept. */
type CommandOf<Message extends RoutedMessage> = Extract<Message, { readonly kind: 'command' }>;

/** What a Service needs on the Broker, unprefixed. */
export type BrokerNeeds<Message extends RoutedMessage, Subscribed extends RoutedSubscription> = {
  readonly streamSubjects: readonly string[];
  readonly durableConsumers: readonly NeededDurableConsumer<CommandOf<Message> | Subscribed>[];
};

/**
 * What a Service needs on the Broker, unprefixed: the subjects of its live Message Versions, which
 * its stream holds, and a Durable consumer for each live Command Version and each Subscription.
 */
export function brokerNeedsOf<Message extends RoutedMessage, Subscribed extends RoutedSubscription>(
  service: string,
  messages: readonly Message[],
  subscriptions: readonly Subscribed[],
): BrokerNeeds<Message, Subscribed> {
  const live = messages.filter(isLive);
  return {
    streamSubjects: live.map((message) => subjectOf(service, message)),
    durableConsumers: [
      ...live.filter(isCommand).map((command) => commandConsumerOf(service, command)),
      ...subscriptions.map((subscription) => subscriptionConsumerOf(service, subscription)),
    ],
  };
}

function isCommand<Message extends RoutedMessage>(message: Message): message is CommandOf<Message> {
  return message.kind === 'command';
}

function commandConsumerOf<Command extends RoutedMessage & { readonly kind: 'command' }>(
  service: string,
  command: Command,
): NeededDurableConsumer<Command> {
  return {
    from: command,
    durable: durableNameOf(service, command),
    stream: streamNameOf(service),
    subject: subjectOf(service, command),
  };
}

function subscriptionConsumerOf<Subscribed extends RoutedSubscription>(
  service: string,
  subscription: Subscribed,
): NeededDurableConsumer<Subscribed> {
  const { name, provider, event } = subscription;
  return {
    from: subscription,
    durable: durableNameOf(service, { kind: 'subscription', name }),
    stream: streamNameOf(provider),
    subject: subjectOf(provider, { kind: 'event', ...event }),
  };
}
