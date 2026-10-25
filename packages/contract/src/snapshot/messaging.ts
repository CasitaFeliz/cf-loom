import { lifecycleOf } from '../declarations/index.ts';
import type { ValidatedSubscription } from '../validation/index.ts';
import type { SchemaNode } from '../walker/index.ts';
import {
  eventReferenceOf,
  type LocatedCommand,
  type LocatedEvent,
  messageIdentityOf,
} from '../written/index.ts';
import type { SnapshotSources } from './context.ts';
import type { CommandSnapshot, EventSnapshot, SubscriptionSnapshot } from './types.ts';

/** Every Event's Message Version by identity, with its Visibility, lifecycle, description and body. */
export function eventSnapshotsOf(
  events: readonly LocatedEvent[],
  sources: SnapshotSources,
): Readonly<Record<string, EventSnapshot>> {
  const entries = events.map(({ event }) => {
    const snapshot: EventSnapshot = {
      visibility: event.visibility,
      lifecycle: lifecycleOf(event),
      description: event.description,
      body: bodyOf(event, sources),
    };
    return [messageIdentityOf(event.name, event.version), snapshot] as const;
  });
  return Object.fromEntries(entries);
}

/** Every Command's Message Version by identity; a Command is always Private, so it writes no Visibility. */
export function commandSnapshotsOf(
  commands: readonly LocatedCommand[],
  sources: SnapshotSources,
): Readonly<Record<string, CommandSnapshot>> {
  const entries = commands.map(({ command }) => {
    const snapshot: CommandSnapshot = {
      lifecycle: lifecycleOf(command),
      description: command.description,
      body: bodyOf(command, sources),
    };
    return [messageIdentityOf(command.name, command.version), snapshot] as const;
  });
  return Object.fromEntries(entries);
}

/** Every Subscription by name, with its Event's Service before the Event's identity. */
export function subscriptionSnapshotsOf(
  subscriptions: readonly ValidatedSubscription[],
): Readonly<Record<string, SubscriptionSnapshot>> {
  const entries = subscriptions.map(({ subscription, service }) => {
    const { name, version } = subscription.event;
    const snapshot: SubscriptionSnapshot = {
      description: subscription.description,
      event: eventReferenceOf(service, name, version),
    };
    return [subscription.name, snapshot] as const;
  });
  return Object.fromEntries(entries);
}

/** A Message Version's body node, which every valid one declares. */
function bodyOf(message: object, { nodeOf }: SnapshotSources): SchemaNode {
  const body = nodeOf(message, 'body');
  if (body === undefined) {
    throw new Error('A valid Message Version walked to no body: a bug.');
  }
  return body;
}
