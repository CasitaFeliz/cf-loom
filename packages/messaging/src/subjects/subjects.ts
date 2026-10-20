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

/** A live version of one of the Service's own Events and the subject it is published on. */
export type PublishedVersion = { readonly message: Event; readonly subject: string };

/** The Active version of one of the Service's own Commands and the subject it is sent on. */
export type SentVersion = { readonly message: Command; readonly subject: string };

/** A Subscription or Command Version `consume` pulls: where its Handler sits in the map, and its durable consumer. */
export type Consumed = {
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
export type Subjects = {
  readonly service: string;
  readonly published: readonly PublishedVersion[];
  readonly sent: readonly SentVersion[];
  readonly consumed: readonly Consumed[];
};

/** The subjects of a root, which must be a Contract whose every Subscription's Event is listed. */
export function subjectsOf(root: unknown): Subjects {
  const contract = contractOf(root);
  const service = contract.name;
  const events = (contract.events ?? []).filter(isLive).toSorted(byVersion);
  const commands = contract.commands ?? [];
  const active = commands.filter((command) => lifecycleOf(command) === 'active');
  return {
    service,
    published: events.map((event) => ({ message: event, subject: subjectOf(service, event) })),
    sent: active.map((command) => ({ message: command, subject: subjectOf(service, command) })),
    consumed: [
      ...commands.filter(isLive).map((command) => consumedCommandOf(service, command)),
      ...(contract.subscriptions ?? []).map((subscription) =>
        consumedSubscriptionOf(contract, subscription),
      ),
    ],
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

function contractOf(root: unknown): Contract {
  if (!isContract(root)) {
    throw new Error('messaging() takes a Contract declared with defineContract');
  }
  return root;
}

function byVersion(left: Event, right: Event): number {
  return left.version - right.version;
}

function consumedCommandOf(service: string, command: Command): Consumed {
  return {
    element: command,
    at: { map: 'commands', key: codeNameOf(command) },
    subject: subjectOf(service, command),
    stream: service,
    durable: durableNameOf(service, command),
  };
}

function consumedSubscriptionOf(contract: Contract, subscription: Subscription): Consumed {
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
