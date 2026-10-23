import { isLive, type Lifecycle } from '../declarations/index.ts';
import type { ServiceSnapshot } from '../snapshot/index.ts';
import { byCodePoint } from '../walker/index.ts';
import {
  durableNameOf,
  prefixedNameOf,
  prefixedSubjectOf,
  streamNameOf,
  subjectOf,
} from '../wire/index.ts';
import { nameAndVersionOf, readEventReference } from '../written/index.ts';

/** A stream of the plan: the Service that owns it, and the subjects it holds in code point order. */
export type BrokerPlanStream = {
  readonly service: string;
  readonly subjects: readonly string[];
};

/** A durable consumer of the plan: the Service it belongs to, the stream it reads and the subject it filters on. */
export type BrokerPlanConsumer = {
  readonly service: string;
  readonly stream: string;
  readonly subject: string;
};

/** What one Service needs on the Broker, keyed by prefixed names, in the shape `cf-loom broker-plan --json` prints. */
export type BrokerPlan = {
  readonly prefix: string | null;
  readonly streams: Readonly<Record<string, BrokerPlanStream>>;
  readonly consumers: Readonly<Record<string, BrokerPlanConsumer>>;
};

type LiveMessage<Kind extends 'event' | 'command'> = {
  readonly kind: Kind;
  readonly name: string;
  readonly version: number;
};

type NamedConsumer = readonly [name: string, consumer: BrokerPlanConsumer];

/**
 * The broker plan of a Service's Snapshot under a prefix `isBrokerPrefix` accepts: its stream when a
 * Message Version of its own is not Retired, and the durable consumer of each Subscription and live Command Version.
 */
export function brokerPlanOf(snapshot: ServiceSnapshot, prefix: string | null): BrokerPlan {
  const consumers = [
    ...commandConsumersOf(snapshot, prefix),
    ...subscriptionConsumersOf(snapshot, prefix),
  ].toSorted(([left], [right]) => byCodePoint(left, right));
  return {
    prefix,
    streams: streamsOf(snapshot, prefix),
    consumers: Object.fromEntries(consumers),
  };
}

function streamsOf(snapshot: ServiceSnapshot, prefix: string | null): BrokerPlan['streams'] {
  const service = snapshot.name;
  const messages = [
    ...liveMessagesOf('event', snapshot.events),
    ...liveMessagesOf('command', snapshot.commands),
  ];
  const subjects = messages.map((message) =>
    prefixedSubjectOf(prefix, subjectOf(service, message)),
  );
  if (subjects.length === 0) {
    return {};
  }
  return {
    [prefixedNameOf(prefix, streamNameOf(service))]: {
      service,
      subjects: subjects.toSorted(byCodePoint),
    },
  };
}

function liveMessagesOf<Kind extends 'event' | 'command'>(
  kind: Kind,
  messages: Readonly<Record<string, { readonly lifecycle: Lifecycle }>>,
): readonly LiveMessage<Kind>[] {
  return Object.entries(messages)
    .filter(([, message]) => isLive(message))
    .map(([identity]) => ({ kind, ...nameAndVersionOf(identity) }));
}

function commandConsumersOf(snapshot: ServiceSnapshot, prefix: string | null): NamedConsumer[] {
  const service = snapshot.name;
  const stream = prefixedNameOf(prefix, streamNameOf(service));
  return liveMessagesOf('command', snapshot.commands).map((command) => [
    prefixedNameOf(prefix, durableNameOf(service, command)),
    { service, stream, subject: prefixedSubjectOf(prefix, subjectOf(service, command)) },
  ]);
}

function subscriptionConsumersOf(
  snapshot: ServiceSnapshot,
  prefix: string | null,
): NamedConsumer[] {
  const service = snapshot.name;
  return Object.entries(snapshot.subscriptions).map(([name, { event }]) => {
    const reference = readEventReference(event);
    if (reference === undefined) {
      throw new Error(`${event} is no Subscription’s Event: a bug.`);
    }
    const { service: provider, ...version } = reference;
    return [
      prefixedNameOf(prefix, durableNameOf(service, { kind: 'subscription', name })),
      {
        service,
        stream: prefixedNameOf(prefix, streamNameOf(provider)),
        subject: prefixedSubjectOf(prefix, subjectOf(provider, { kind: 'event', ...version })),
      },
    ];
  });
}
