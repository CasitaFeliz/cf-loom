import {
  type Dependency,
  isDependency,
  type Root,
  type ServiceContract,
} from '../declarations/index.ts';
import { providerExportsOf, providerNameOf } from './declarations.ts';
import { eventsOf } from './grouped.ts';
import { listOf, textOf } from './written.ts';

/**
 * Where a Contract takes an Event it subscribes to from: the Contract itself when one of its Groups
 * lists it, else the listed Dependency whose Contract Package exports that very Event; none when
 * neither does, or the Root is no Service's Contract. Events are compared, never Contract Packages, since a
 * Dependency holds a frozen copy of the one imported.
 */
export function eventSourceOf(
  root: Root,
  event: unknown,
): ServiceContract | Dependency | undefined {
  if (root.kind !== 'service') {
    return undefined;
  }
  const ownEvents: readonly unknown[] = eventsOf(root);
  if (ownEvents.includes(event)) {
    return root;
  }
  return listOf(root.dependencies)
    .filter(isDependency)
    .find((dependency) => providerExportsOf(dependency).events.includes(event));
}

/** The Service that publishes an Event a Contract subscribes to: the Contract's own name, or its source's Provider's. */
export function eventServiceOf(root: Root, event: unknown): string | undefined {
  const source = eventSourceOf(root, event);
  if (source === undefined) {
    return undefined;
  }
  return source.kind === 'dependency' ? providerNameOf(source) : textOf(source.name);
}
