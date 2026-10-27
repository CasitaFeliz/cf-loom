import type { ValidatedProvider } from '../validation/index.ts';
import { byCodePoint } from '../walker/index.ts';
import { identityOf } from '../written/index.ts';
import type { DependencySnapshot } from './types.ts';

/**
 * Each Provider a Contract uses, by its Dependencies or its Subscriptions, against the version of
 * the installed package its Elements come from, with the Endpoints its Dependencies list by
 * identity with their names, sorted since neither their order nor how they are split into
 * Dependencies means anything. The Events a Contract receives are its Subscriptions'.
 */
export function dependencySnapshotsOf(
  providers: readonly ValidatedProvider[],
): Readonly<Record<string, DependencySnapshot>> {
  const entries = providers.map(({ name, endpoints, from }) => {
    const listed = endpoints.map((endpoint) => ({
      id: identityOf(endpoint.method, endpoint.path),
      name: endpoint.name,
    }));
    const snapshot: DependencySnapshot = {
      against: from.version,
      endpoints: listed.sort((left, right) => byCodePoint(left.id, right.id)),
    };
    return [name, snapshot] as const;
  });
  return Object.fromEntries(entries);
}
