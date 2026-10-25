import { type Contract, type Dependency, isDependency } from '../declarations/index.ts';
import { providerNameOf } from './declarations.ts';
import { eventsOf } from './grouped.ts';
import type { Root } from './located.ts';
import { listOf, partOf, textOf } from './written.ts';

/**
 * Where a Contract takes an Event it subscribes to from: the Contract itself when one of its Groups
 * lists it, else the listed Dependency whose Contract Package exports that very Event; none when
 * neither does, or the root is no Contract. Events are compared, never Contract Packages, since a
 * Dependency holds a frozen copy of the one imported.
 */
export function eventSourceOf(root: Root, event: unknown): Contract | Dependency | undefined {
  if (root.kind !== 'contract') {
    return undefined;
  }
  const ownEvents: readonly unknown[] = eventsOf(root);
  if (ownEvents.includes(event)) {
    return root;
  }
  return listOf(root.dependencies)
    .filter(isDependency)
    .find((dependency) => exportedEventsOf(dependency).includes(event));
}

/** The Service that publishes an Event a Contract subscribes to: the Contract's own name, or its source's Provider's. */
export function eventServiceOf(root: Root, event: unknown): string | undefined {
  const source = eventSourceOf(root, event);
  if (source === undefined) {
    return undefined;
  }
  return source.kind === 'dependency' ? providerNameOf(source) : textOf(source.name);
}

/** What a Dependency's Provider exports as Events; none when a cast left its Contract Package without them. */
function exportedEventsOf(dependency: Dependency): readonly unknown[] {
  return Object.values(partOf(partOf<'events'>(dependency.provider).events));
}
