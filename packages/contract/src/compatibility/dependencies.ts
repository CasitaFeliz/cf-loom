import type { ByKey, DependencySnapshot } from '../snapshot/index.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import type { Difference, SiteDifferences } from './report.ts';

/** An Endpoint a Dependency lists, by identity, with the name its Provider gave it. */
type Selected = DependencySnapshot['endpoints'][number];

/**
 * The Providers a Service or an Application uses, in code point order: added, removed, or kept,
 * the version it is declared against and then the Endpoints its Dependencies list by identity. Each is
 * Neutral, since no Consumer relies on what a Service itself consumes.
 */
export function dependencyDifferencesOf(
  baseline: ByKey<DependencySnapshot>,
  proposed: ByKey<DependencySnapshot>,
): readonly SiteDifferences[] {
  return counterpartsOf(baseline, proposed).map(
    (dependency): SiteDifferences => ({
      site: { kind: 'dependency', name: dependency.key, visibility: 'private' },
      differences: differencesOf(dependency),
    }),
  );
}

function differencesOf(dependency: Counterpart<DependencySnapshot>): readonly Difference[] {
  switch (dependency.kind) {
    case 'added':
      return [{ kind: 'added' }];
    case 'removed':
      return [{ kind: 'removed' }];
    case 'kept':
      return keptDifferencesOf(dependency.baseline, dependency.proposed);
  }
}

function keptDifferencesOf(
  baseline: DependencySnapshot,
  proposed: DependencySnapshot,
): readonly Difference[] {
  const against: readonly Difference[] =
    baseline.against === proposed.against
      ? []
      : [{ kind: 'against-changed', from: baseline.against, to: proposed.against }];
  return [...against, ...selectionDifferencesOf(baseline.endpoints, proposed.endpoints)];
}

function selectionDifferencesOf(
  baseline: readonly Selected[],
  proposed: readonly Selected[],
): readonly Difference[] {
  const differences: Difference[] = [];
  for (const endpoint of counterpartsOf(byIdentity(baseline), byIdentity(proposed))) {
    const difference = selectionDifferenceOf(endpoint);
    if (difference !== undefined) {
      differences.push(difference);
    }
  }
  return differences;
}

function selectionDifferenceOf(endpoint: Counterpart<Selected>): Difference | undefined {
  switch (endpoint.kind) {
    case 'added':
      return { kind: 'endpoint-added', ...endpoint.proposed };
    case 'removed':
      return { kind: 'endpoint-removed', ...endpoint.baseline };
    case 'kept':
      return endpoint.baseline.name === endpoint.proposed.name
        ? undefined
        : {
            kind: 'endpoint-renamed',
            id: endpoint.key,
            from: endpoint.baseline.name,
            to: endpoint.proposed.name,
          };
  }
}

function byIdentity(endpoints: readonly Selected[]): ByKey<Selected> {
  return Object.fromEntries(endpoints.map((endpoint) => [endpoint.id, endpoint]));
}
