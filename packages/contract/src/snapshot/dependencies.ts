import { byCodePoint } from '../walker/index.ts';
import { identityOf, type LocatedDependencies, messageIdentityOf } from '../written/index.ts';
import type { DependencySnapshot } from './types.ts';

/**
 * The Dependencies by Provider, each with the version it was declared against, its Endpoints by
 * identity with their names and its Events by identity, sorted since their order means nothing.
 */
export function dependencySnapshotsOf(
  located: readonly LocatedDependencies[],
): Readonly<Record<string, DependencySnapshot>> {
  const entries = located.map(({ dependencies }) => {
    const endpoints = Object.values(dependencies.endpoints).map(({ method, path, name }) => ({
      id: identityOf(method, path),
      name,
    }));
    const events = Object.values(dependencies.events).map(({ name, version }) =>
      messageIdentityOf(name, version),
    );
    const dependency: DependencySnapshot = {
      against: dependencies.against,
      endpoints: endpoints.sort((left, right) => byCodePoint(left.id, right.id)),
      events: events.sort(byCodePoint),
    };
    return [dependencies.provider, dependency] as const;
  });
  return Object.fromEntries(entries);
}
