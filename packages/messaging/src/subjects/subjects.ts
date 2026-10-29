import type { Command, Event, ServiceContract, Subscription } from '@cf-loom/contract';
import {
  brokerNeedsOf,
  codeNameOf,
  commandsOf,
  eventServiceOf,
  eventsOf,
  isLive,
  isServiceContract,
  lifecycleOf,
  type NeededDurableConsumer,
  type RoutedSubscription,
  streamNameOf,
  subjectOf,
  subscriptionsOf,
} from '@cf-loom/contract/internal';

/** A live version of one of the Service's own Events and the subject it is published on. */
export type PublishedVersion = { readonly message: Event; readonly subject: string };

/** The Active version of one of the Service's own Commands and the subject it is sent on. */
export type SentVersion = { readonly message: Command; readonly subject: string };

/** A Subscription or Command Version `consume` pulls: where its Handler sits in the map, and its Durable consumer. */
export type Consumed = {
  readonly declaration: Subscription | Command;
  readonly at: { readonly map: 'commands' | 'subscriptions'; readonly key: string };
  readonly subject: string;
  readonly stream: string;
  readonly durable: string;
};

/**
 * Where each Message of a Contract travels, computed once: the Service's name and its stream, its
 * live Events in version order, its Active Commands, and what `consume` pulls.
 */
export type Subjects = {
  readonly service: string;
  readonly stream: string;
  readonly published: readonly PublishedVersion[];
  readonly sent: readonly SentVersion[];
  readonly consumed: readonly Consumed[];
};

/** The subjects of a Root, which must be a Service's Contract whose every Subscription's Event is listed. */
export function subjectsOf(root: unknown): Subjects {
  const contract = contractOf(root);
  const service = contract.name;
  const events = eventsOf(contract).filter(isLive).toSorted(byVersion);
  const commands = commandsOf(contract);
  const subscriptions = subscriptionsOf(contract).map((subscription) =>
    routeOf(contract, subscription),
  );
  const { durableConsumers } = brokerNeedsOf(service, commands, subscriptions);
  const active = commands.filter((command) => lifecycleOf(command) === 'active');
  return {
    service,
    stream: streamNameOf(service),
    published: events.map((event) => ({ message: event, subject: subjectOf(service, event) })),
    sent: active.map((command) => ({ message: command, subject: subjectOf(service, command) })),
    consumed: durableConsumers.map(consumedOf),
  };
}

/** The live versions of an Event the Service publishes, in version order; a name it does not publish is a bug. */
export function publishedVersionsOf(subjects: Subjects, name: string): readonly PublishedVersion[] {
  const published = subjects.published.filter((version) => version.message.name === name);
  if (published.length === 0) {
    throw new Error(`${name} is no Event the Contract publishes`);
  }
  return published;
}

/** The one Active version of a Command; none, or more than one, is a bug. */
export function sentVersionOf(subjects: Subjects, name: string): SentVersion {
  const [sent, ...others] = subjects.sent.filter((version) => version.message.name === name);
  if (sent === undefined || others.length > 0) {
    throw new Error(`send() takes a Command with one Active version, which ${name} is not`);
  }
  return sent;
}

function contractOf(root: unknown): ServiceContract {
  if (!isServiceContract(root)) {
    throw new Error("messaging() takes a Service's Contract declared with defineService");
  }
  return root;
}

function byVersion(left: Event, right: Event): number {
  return left.version - right.version;
}

/** A Subscription with the Provider of its Event, as the Broker routes it. */
type SubscriptionRoute = RoutedSubscription & {
  readonly kind: 'subscription';
  readonly declaration: Subscription;
};

function routeOf(contract: ServiceContract, subscription: Subscription): SubscriptionRoute {
  const provider = eventServiceOf(contract, subscription.event);
  if (provider === undefined) {
    const message = `${subscription.name} subscribes to an Event neither a Group lists nor another Service's Contract Package exports`;
    throw new Error(message);
  }
  return {
    kind: 'subscription',
    name: subscription.name,
    provider,
    event: subscription.event,
    declaration: subscription,
  };
}

function consumedOf(need: NeededDurableConsumer<Command | SubscriptionRoute>): Consumed {
  const { from, ...broker } = need;
  switch (from.kind) {
    case 'command':
      return { declaration: from, at: { map: 'commands', key: codeNameOf(from) }, ...broker };
    case 'subscription':
      return {
        declaration: from.declaration,
        at: { map: 'subscriptions', key: from.name },
        ...broker,
      };
  }
}
