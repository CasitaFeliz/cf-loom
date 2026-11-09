import { z } from 'zod';
import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  providedEvent,
  type Subscription,
} from '../src/index.ts';
import {
  type BrokerPlan,
  brokerPlanOf,
  type Failure,
  snapshotOf,
  validateRoot,
} from '../src/internal/index.ts';
import { aRootPackage } from './root-package.ts';

/** A Message Version of a Service's own, as a draw names it. */
export type ModelMessage = {
  readonly name: string;
  readonly version: number;
  readonly lifecycle: 'active' | 'deprecated' | 'retired';
};

/** A Subscription as a draw names it: a Provider's Event, or the Service's own when `provider` is `undefined`. */
export type ModelSubscription = {
  readonly name: string;
  readonly provider: string | undefined;
  readonly event: { readonly name: string; readonly version: number };
};

/** What a Service declares that the Broker routes, in the names an author writes. */
export type ServiceModel = {
  readonly service: string;
  readonly events: readonly ModelMessage[];
  readonly commands: readonly ModelMessage[];
  readonly subscriptions: readonly ModelSubscription[];
};

/** What declaring a model through the public API gives: the plan `cf-loom broker-plan` prints, or the refusal of `generate` and whether only the rule a plan leaves out refused it. */
export type PrintedModel =
  | { readonly kind: 'printed'; readonly plan: BrokerPlan }
  | { readonly kind: 'refused'; readonly isOnlyByRuleThePlanLeavesOut: boolean };

/** The one rule a Broker plan says nothing of, since its names print a Service that breaks it: one kind for each Message name. */
const ruleThePlanLeavesOut = 'message-kind';

/** The plan `cf-loom broker-plan` prints for a model declared through the public API, or why `generate` refuses the Service. */
export function brokerPlanOfModel(model: ServiceModel, prefix: string | null): PrintedModel {
  const root = declaredRootOf(model);
  const validated = validateRoot(root, aRootPackage(root, { packageName: model.service }));
  if (validated.kind !== 'valid') {
    const isLeftOut = (failure: Failure) =>
      failure.kind === 'declaration' && failure.rule === ruleThePlanLeavesOut;
    return { kind: 'refused', isOnlyByRuleThePlanLeavesOut: validated.failures.every(isLeftOut) };
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    return { kind: 'refused', isOnlyByRuleThePlanLeavesOut: false };
  }
  return { kind: 'printed', plan: brokerPlanOf(snapshot, prefix) };
}

const body = z.object({ id: z.string() });

function declaredRootOf(model: ServiceModel) {
  const events = model.events.map((message) =>
    defineEvent({ ...message, visibility: 'internal', description: 'An Event', body }),
  );
  const commands = model.commands.map((message) =>
    defineCommand({ ...message, description: 'A Command', body }),
  );
  const subscriptions = subscriptionsOf(model, events);
  const lists = Object.entries({ events, commands, subscriptions }).filter(
    ([, items]) => items.length > 0,
  );
  const group = defineGroup({
    name: 'messages',
    description: 'Messages',
    ...Object.fromEntries(lists),
  } as unknown as Parameters<typeof defineGroup>[0]);
  return defineService({ name: model.service, groups: lists.length === 0 ? [] : [group] });
}

/** The Subscriptions of a model: each to an Event of its own, which a draw never leaves Retired, or to a Provider's. */
function subscriptionsOf(model: ServiceModel, own: readonly { name: string; version: number }[]) {
  const provided = new Map<string, Subscription['event']>();
  return model.subscriptions.map(({ name, provider, event }) => {
    const key = `${provider}/${event.name}/${event.version}`;
    const declaration = {
      ...event,
      visibility: 'internal',
      description: 'An Event',
      body,
    } as const;
    const foreign = provider === undefined ? undefined : providedEvent(provider, declaration);
    const ownEvent = own.find((one) => one.name === event.name && one.version === event.version);
    const received = foreign === undefined ? ownEvent : (provided.get(key) ?? foreign);
    if (received === undefined) {
      throw new Error(`The model subscribes to ${key}, which it does not declare`);
    }
    const subscribed = received as Subscription['event'];
    provided.set(key, subscribed);
    return defineSubscription({ name, description: 'A Subscription', event: subscribed });
  });
}

/** A text without the prefix and its separator, or nothing when it does not start with them. */
function afterPrefix(
  prefix: string | null,
  text: string,
  separator: '.' | '_',
): string | undefined {
  if (prefix === null) {
    return text;
  }
  return text.startsWith(`${prefix}${separator}`) ? text.slice(prefix.length + 1) : undefined;
}

type SubjectParts = {
  readonly service: string;
  readonly kind: 'event' | 'command';
  readonly name: string;
  readonly version: number;
};

function subjectPartsOf(prefix: string | null, subject: string): SubjectParts | undefined {
  const rest = afterPrefix(prefix, subject, '.')?.split('.') ?? [];
  const [service = '', kind, name = '', version = '', ...more] = rest;
  const isRead =
    more.length === 0 && version.startsWith('v') && (kind === 'event' || kind === 'command');
  return isRead ? { service, kind, name, version: Number(version.slice(1)) } : undefined;
}

/** The Subscription a Durable consumer's name says, if it is not a Command Version's, and its Service. */
function subscriptionOfDurableConsumer(prefix: string | null, name: string) {
  const [service = '', ...tail] = afterPrefix(prefix, name, '_')?.split('_') ?? [];
  const isCommand = tail[0] === 'command' && tail.length === 3;
  const subscription = tail
    .join('_')
    .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return { service, subscription: isCommand ? undefined : subscription };
}

/**
 * The Service a plan is the plan of, declared back from its texts: the oracle of every plan a decoder
 * accepts, read here by splitting its names, never by the decoder's own readers. Nothing when a
 * subject does not split.
 */
export function modelOfPlan(plan: BrokerPlan): ServiceModel | undefined {
  const streams = Object.values(plan.streams);
  const durableConsumers = Object.entries(plan.durableConsumers);
  const service = streams[0]?.service ?? durableConsumers[0]?.[1].service ?? 'empty-service';
  const streamed = streams.flatMap((stream) => stream.subjects);
  const subjects = streamed.map((subject) => subjectPartsOf(plan.prefix, subject));
  const received = durableConsumers.map(([, durableConsumer]) =>
    subjectPartsOf(plan.prefix, durableConsumer.subject),
  );
  if (subjects.includes(undefined) || received.includes(undefined)) {
    return undefined;
  }
  const subscriptions: ModelSubscription[] = [];
  for (const [index, [name]] of durableConsumers.entries()) {
    const { subscription } = subscriptionOfDurableConsumer(plan.prefix, name);
    const event = received[index];
    if (subscription !== undefined && event !== undefined) {
      const provider = event.service === service ? undefined : event.service;
      subscriptions.push({ name: subscription, provider, event });
    }
  }
  return modelOf(service, subjects.filter(isDefined), subscriptions);
}

function isDefined<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}

/** The model of a Service whose live Messages are the given subjects, a Command with its first Version Active, and whose Subscriptions are given. */
function modelOf(
  service: string,
  subjects: readonly SubjectParts[],
  subscriptions: readonly ModelSubscription[],
): ServiceModel {
  const messages = new Map<string, ModelMessage & { readonly kind: 'event' | 'command' }>();
  const activeCommands = new Set<string>();
  for (const { kind, name, version } of subjects) {
    const isFirstVersion = kind === 'command' && !activeCommands.has(name);
    activeCommands.add(name);
    const lifecycle = kind === 'command' && !isFirstVersion ? 'deprecated' : 'active';
    messages.set(`${kind}/${name}/${version}`, { kind, name, version, lifecycle });
  }
  const withKind = (kind: 'event' | 'command') =>
    [...messages.values()]
      .filter((message) => message.kind === kind)
      .map(({ name, version, lifecycle }) => ({ name, version, lifecycle }));
  return { service, events: withKind('event'), commands: withKind('command'), subscriptions };
}
