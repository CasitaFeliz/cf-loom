import type { Contract } from '../declarations/index.ts';
import { isCommand, isDependencies, isEvent, isSubscription } from '../declarations/index.ts';
import { messageIdentityOf } from './identity.ts';
import type { LocatedCommand, LocatedEvent, LocatedSubscription, Root } from './located.ts';
import { listOf, partOf, textOf } from './written.ts';

/** A root's Events, Commands and Subscriptions with their locations; only a Contract has them. */
export type LocatedMessages = {
  readonly events: readonly LocatedEvent[];
  readonly commands: readonly LocatedCommand[];
  readonly subscriptions: readonly LocatedSubscription[];
};

/** Gathers a root's Events, Commands and Subscriptions, each where it sits by identity or name. */
export function messagesOf(root: Root): LocatedMessages {
  if (root.kind !== 'contract') {
    return { events: [], commands: [], subscriptions: [] };
  }
  return {
    events: listOf(root.events)
      .filter(isEvent)
      .map((event) => ({ at: ['events', messageIdentityOf(event.name, event.version)], event })),
    commands: listOf(root.commands)
      .filter(isCommand)
      .map((command) => ({
        at: ['commands', messageIdentityOf(command.name, command.version)],
        command,
      })),
    subscriptions: listOf(root.subscriptions)
      .filter(isSubscription)
      .map((subscription) => ({ at: ['subscriptions', textOf(subscription.name)], subscription })),
  };
}

/**
 * The Service that publishes an Event a Contract subscribes to: its own when its root lists it,
 * else the Provider whose Dependency lists it; none when neither does.
 */
export function eventServiceOf(contract: Contract, event: unknown): string | undefined {
  const ownEvents: readonly unknown[] = listOf(contract.events);
  if (ownEvents.includes(event)) {
    return textOf(contract.name);
  }
  const listing = listOf(contract.dependencies)
    .filter(isDependencies)
    .find((dependencies) => Object.values(partOf(dependencies.events)).includes(event));
  return listing === undefined ? undefined : textOf(listing.provider);
}
