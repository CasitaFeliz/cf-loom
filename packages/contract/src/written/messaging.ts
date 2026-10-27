import { providerOf, type Root } from '../declarations/index.ts';
import { eventsOf } from './grouped.ts';
import { textOf } from './written.ts';

/** Where a Contract takes an Event it subscribes to from, and the Service that publishes it. */
export type EventSource = { readonly kind: 'own' | 'provided'; readonly service: string };

/**
 * Where a Contract takes an Event it subscribes to from: the Contract itself when one of its Groups
 * lists it, else the Provider whose name marks it; none when neither does, or the Root is no
 * Service's Contract.
 */
export function eventSourceOf(root: Root, event: unknown): EventSource | undefined {
  if (root.kind !== 'service') {
    return undefined;
  }
  const ownEvents: readonly unknown[] = eventsOf(root);
  if (ownEvents.includes(event)) {
    return { kind: 'own', service: textOf(root.name) };
  }
  const provider = providerOf(event);
  return provider === undefined ? undefined : { kind: 'provided', service: provider };
}

/** The Service that publishes an Event a Contract subscribes to: the Contract's own name, or its Provider's. */
export function eventServiceOf(root: Root, event: unknown): string | undefined {
  return eventSourceOf(root, event)?.service;
}
