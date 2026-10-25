import { type Dependency, isDependency } from '../declarations/index.ts';
import { providerNameOf } from './declarations.ts';
import { eventsOf } from './grouped.ts';
import type { Root } from './located.ts';
import { listOf, partOf, textOf } from './written.ts';

/**
 * The Service that publishes an Event a Contract subscribes to: its own when one of its Groups lists
 * it, else the Provider of the listed Dependency whose Contract Package exports that very Event;
 * none when neither does, or the root is no Contract. Events are compared, never Contract
 * Packages, since a Dependency holds a frozen copy of the one imported.
 */
export function eventServiceOf(root: Root, event: unknown): string | undefined {
  if (root.kind !== 'contract') {
    return undefined;
  }
  const ownEvents: readonly unknown[] = eventsOf(root);
  if (ownEvents.includes(event)) {
    return textOf(root.name);
  }
  const listing = listOf(root.dependencies)
    .filter(isDependency)
    .find((dependency) => exportedEventsOf(dependency).includes(event));
  return listing === undefined ? undefined : providerNameOf(listing);
}

/** What a Dependency's Provider exports as Events; none when a cast left its Contract Package without them. */
function exportedEventsOf(dependency: Dependency): readonly unknown[] {
  return Object.values(partOf(partOf<'events'>(dependency.provider).events));
}
