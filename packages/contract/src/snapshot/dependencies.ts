import type { ValidatedDependency } from '../validation/index.ts';
import { byCodePoint } from '../walker/index.ts';
import { identityOf, listOf, providerNameOf, textOf } from '../written/index.ts';
import type { DependencySnapshot } from './types.ts';

/**
 * The Dependencies by Provider, each against the version of the installed package its Provider is
 * and with its Endpoints by identity with their names, sorted since their order means nothing. The Events a Contract
 * receives are its Subscriptions'.
 */
export function dependencySnapshotsOf(
  validated: readonly ValidatedDependency[],
): Readonly<Record<string, DependencySnapshot>> {
  const entries = validated.map(({ dependency, from }) => {
    const endpoints = listOf(dependency.endpoints).map(({ method, path, name }) => ({
      id: identityOf(method, path),
      name,
    }));
    const snapshot: DependencySnapshot = {
      against: from.version,
      endpoints: endpoints.sort((left, right) => byCodePoint(left.id, right.id)),
    };
    return [textOf(providerNameOf(dependency)), snapshot] as const;
  });
  return Object.fromEntries(entries);
}
