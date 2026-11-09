import type { Lifecycle } from '../declarations/index.ts';
import { unbrokenLineOf } from '../lines/index.ts';
import type { ServiceSnapshot } from '../snapshot/index.ts';
import { byCodePoint } from '../walker/index.ts';
import {
  brokerNeedsOf,
  type NeededDurableConsumer,
  prefixedNameOf,
  prefixedSubjectOf,
  type RoutedMessage,
  type RoutedSubscription,
  streamNameOf,
} from '../wire/index.ts';
import { nameAndVersionOf, readEventReference } from '../written/index.ts';

/** A stream of the plan: the Service that owns it, and the subjects it holds in code point order. */
export type BrokerPlanStream = {
  readonly service: string;
  readonly subjects: readonly string[];
};

/** A Durable consumer of the plan: the Service it belongs to, the stream it reads and the subject it filters on. */
export type BrokerPlanDurableConsumer = {
  readonly service: string;
  readonly stream: string;
  readonly subject: string;
};

/** What one Service needs on the Broker, keyed by prefixed names, in the shape of the `plan` of the document `cf-loom broker-plan --json` prints. */
export type BrokerPlan = {
  readonly prefix: string | null;
  readonly streams: Readonly<Record<string, BrokerPlanStream>>;
  readonly durableConsumers: Readonly<Record<string, BrokerPlanDurableConsumer>>;
};

/**
 * The broker plan of a Service's Snapshot under a prefix `isBrokerPrefix` accepts: its stream when a
 * Message Version of its own is not Retired, and the Durable consumer of each Subscription and live Command Version.
 */
export function brokerPlanOf(snapshot: ServiceSnapshot, prefix: string | null): BrokerPlan {
  const routed = {
    service: snapshot.name,
    messages: [
      ...messagesOf('event', snapshot.events),
      ...messagesOf('command', snapshot.commands),
    ],
    subscriptions: Object.entries(snapshot.subscriptions).map(subscriptionOf),
  };
  return brokerPlanOfRoutes(routed, prefix);
}

/** What one Service routes over the Broker: its Message Versions and the Subscriptions it holds. */
export type RoutedService = {
  readonly service: string;
  readonly messages: readonly RoutedMessage[];
  readonly subscriptions: readonly RoutedSubscription[];
};

/** The broker plan of a Service's Message Versions and Subscriptions under a prefix: what `brokerPlanOf` prints from its Snapshot. */
export function brokerPlanOfRoutes(routed: RoutedService, prefix: string | null): BrokerPlan {
  const { service, messages, subscriptions } = routed;
  const needs = brokerNeedsOf(service, messages, subscriptions);
  const durableConsumers = needs.durableConsumers
    .map((need) => namedDurableConsumerOf(service, prefix, need))
    .toSorted(([left], [right]) => byCodePoint(left, right));
  return {
    prefix,
    streams: streamsOf(service, needs.streamSubjects, prefix),
    durableConsumers: Object.fromEntries(durableConsumers),
  };
}

type NamedDurableConsumer = readonly [name: string, durableConsumer: BrokerPlanDurableConsumer];

function namedDurableConsumerOf(
  service: string,
  prefix: string | null,
  need: NeededDurableConsumer<unknown>,
): NamedDurableConsumer {
  return [
    prefixedNameOf(prefix, need.durable),
    {
      service,
      stream: prefixedNameOf(prefix, need.stream),
      subject: prefixedSubjectOf(prefix, need.subject),
    },
  ];
}

function streamsOf(
  service: string,
  streamSubjects: readonly string[],
  prefix: string | null,
): BrokerPlan['streams'] {
  if (streamSubjects.length === 0) {
    return {};
  }
  const subjects = streamSubjects.map((subject) => prefixedSubjectOf(prefix, subject));
  return {
    [prefixedNameOf(prefix, streamNameOf(service))]: {
      service,
      subjects: subjects.toSorted(byCodePoint),
    },
  };
}

function messagesOf(
  kind: 'event' | 'command',
  messages: Readonly<Record<string, { readonly lifecycle: Lifecycle }>>,
): readonly RoutedMessage[] {
  return Object.entries(messages).map(([identity, { lifecycle }]) => ({
    kind,
    ...nameAndVersionOf(identity),
    lifecycle,
  }));
}

function subscriptionOf([name, { event }]: readonly [
  string,
  { readonly event: string },
]): RoutedSubscription {
  const reference = readEventReference(event);
  if (reference === undefined) {
    throw new Error(unbrokenLineOf(`${event} is no Subscription’s Event: a bug.`));
  }
  const { service: provider, ...version } = reference;
  return { name, provider, event: version };
}
