import { isDependencies } from '../declarations/index.ts';
import { eventsOf } from './grouped.ts';
import type { Root } from './located.ts';
import { listOf, partOf, textOf } from './written.ts';

/**
 * The Service that publishes an Event a Contract subscribes to: its own when one of its Groups lists it,
 * else the Provider whose Dependency lists it; none when neither does, or the root is no Contract.
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
    .filter(isDependencies)
    .find((dependencies) => Object.values(partOf(dependencies.events)).includes(event));
  return listing === undefined ? undefined : textOf(listing.provider);
}
