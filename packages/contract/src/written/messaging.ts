import { providerOf, type Root } from '../declarations/index.ts';
import { eventsOf } from './grouped.ts';
import { isOwnProvided } from './own-provider.ts';
import { textOf } from './written.ts';

/**
 * Where a Contract takes an Event it subscribes to from, and the Service that publishes it: `own`
 * for an Event one of its Groups lists, `provided` for another Service's, and `own-provider` for
 * one of its own Contract Package, which a Provider's cannot be.
 */
export type EventSource = {
  readonly kind: 'own' | 'own-provider' | 'provided';
  readonly service: string;
};

/**
 * Where a Contract takes an Event it subscribes to from: the Contract itself when one of its Groups
 * lists it, else the Provider whose name marks it; none when neither does, or when the Root is no
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
  if (provider === undefined) {
    return undefined;
  }
  return { kind: isOwnProvided(root, event) ? 'own-provider' : 'provided', service: provider };
}

/** The Service that publishes an Event a Contract subscribes to: the Contract's own name, or its Provider's; none for an Event of its own Contract Package. */
export function eventServiceOf(root: Root, event: unknown): string | undefined {
  const source = eventSourceOf(root, event);
  return source?.kind === 'own-provider' ? undefined : source?.service;
}
