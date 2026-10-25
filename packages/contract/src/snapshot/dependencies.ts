import { byCodePoint } from '../walker/index.ts';
import {
  identityOf,
  type LocatedDependency,
  listOf,
  providerNameOf,
  textOf,
} from '../written/index.ts';
import type { DependencySnapshot } from './types.ts';

/**
 * The Dependencies by Provider, each with the version it was declared against and its Endpoints
 * by identity with their names, sorted since their order means nothing. The Events a Contract
 * receives are its Subscriptions'.
 */
export function dependencySnapshotsOf(
  located: readonly LocatedDependency[],
): Readonly<Record<string, DependencySnapshot>> {
  const entries = located.map(({ dependency }) => {
    const endpoints = listOf(dependency.endpoints).map(({ method, path, name }) => ({
      id: identityOf(method, path),
      name,
    }));
    const snapshot: DependencySnapshot = {
      against: dependency.provider.version,
      endpoints: endpoints.sort((left, right) => byCodePoint(left.id, right.id)),
    };
    return [textOf(providerNameOf(dependency)), snapshot] as const;
  });
  return Object.fromEntries(entries);
}
