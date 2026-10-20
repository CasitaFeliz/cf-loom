import type { Command, Contract, Event, Subscription } from '@cf-loom/contract';
import {
  codeNameOf,
  durableNameOf,
  eventServiceOf,
  isContract,
  isLive,
  lifecycleOf,
  subjectOf,
} from '@cf-loom/contract/internal';

/** One of the Service's own Message Versions and the subject it is sent on. */
export type SentRoute<Message extends Event | Command> = {
  readonly message: Message;
  readonly subject: string;
};

/** A Subscription or Command Version `consume` pulls: where its Handler sits in the map, and its durable consumer. */
export type ConsumedRoute = {
  readonly element: Subscription | Command;
  readonly at: { readonly map: 'commands' | 'subscriptions'; readonly key: string };
  readonly subject: string;
  readonly stream: string;
  readonly durable: string;
};

/**
 * Where each Message of a Contract travels, computed once: the Service's name, its live Events in
 * version order, its Active Commands, and what `consume` pulls.
 */
export type Routes = {
  readonly service: string;
  readonly events: readonly SentRoute<Event>[];
  readonly commands: readonly SentRoute<Command>[];
  readonly consumed: readonly ConsumedRoute[];
};

/** The routes of a root, which must be a Contract whose every Subscription's Event is listed. */
export function routesOf(root: unknown): Routes {
  const contract = contractOf(root);
  const service = contract.name;
  const events = (contract.events ?? []).filter(isLive).toSorted(byVersion);
  const commands = contract.commands ?? [];
  const active = commands.filter((command) => lifecycleOf(command) === 'active');
  return {
    service,
    events: events.map((event) => ({ message: event, subject: subjectOf(service, event) })),
    commands: active.map((command) => ({ message: command, subject: subjectOf(service, command) })),
    consumed: [
      ...commands.filter(isLive).map((command) => consumedCommandOf(service, command)),
      ...(contract.subscriptions ?? []).map((subscription) =>
        consumedSubscriptionOf(contract, subscription),
      ),
    ],
  };
}

/** The live versions of an Event the Service publishes, in version order; a name it does not publish is a bug. */
export function publishedRoutesOf(routes: Routes, name: string): readonly SentRoute<Event>[] {
  const published = routes.events.filter((route) => route.message.name === name);
  if (published.length === 0) {
    throw new Error(`${name} is no Event the Contract publishes`);
  }
  return published;
}

/** The one Active version of a Command; none, or more than one, is a bug. */
export function sentRouteOf(routes: Routes, name: string): SentRoute<Command> {
  const [sent, ...others] = routes.commands.filter((route) => route.message.name === name);
  if (sent === undefined || others.length > 0) {
    throw new Error(`send() takes a Command with one Active version, which ${name} is not`);
  }
  return sent;
}

function contractOf(root: unknown): Contract {
  if (!isContract(root)) {
    throw new Error('messaging() takes a Contract declared with defineContract');
  }
  return root;
}

function byVersion(left: Event, right: Event): number {
  return left.version - right.version;
}

function consumedCommandOf(service: string, command: Command): ConsumedRoute {
  return {
    element: command,
    at: { map: 'commands', key: codeNameOf(command) },
    subject: subjectOf(service, command),
    stream: service,
    durable: durableNameOf(service, command),
  };
}

function consumedSubscriptionOf(contract: Contract, subscription: Subscription): ConsumedRoute {
  const stream = eventServiceOf(contract, subscription.event);
  if (stream === undefined) {
    const message = `${subscription.name} subscribes to an Event neither the root nor a Dependency lists`;
    throw new Error(message);
  }
  return {
    element: subscription,
    at: { map: 'subscriptions', key: subscription.name },
    subject: subjectOf(stream, subscription.event),
    stream,
    durable: durableNameOf(contract.name, subscription),
  };
}
