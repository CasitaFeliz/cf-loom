import { reaches, type Visibility } from '../declarations/index.ts';
import { compareSemanticVersions, type DependencySnapshot } from '../snapshot/index.ts';
import { byCodePoint } from '../walker/index.ts';
import type { GraphDependency } from './report.ts';

/**
 * One Contract Package of the dependency graph: the highest published version of one of its majors
 * that is not deprecated, with its kind and the Dependencies its `cfLoom` metadata records.
 */
export type GraphPackage = {
  readonly name: string;
  readonly version: string;
  readonly kind: 'service' | 'application';
  readonly dependencies: Readonly<Record<string, DependencySnapshot>>;
};

/** Every Contract Package version whose Dependencies the Compatibility Check reads before an Element is Retired, renamed or narrowed. */
export type DependencyGraph = readonly GraphPackage[];

/** An Element a Contract can depend on: an Endpoint or an Event, by identity. */
type Dependable = { readonly kind: 'endpoint' | 'event'; readonly identity: string };

/** The Dependencies the graph holds on one Element of a Service, by the Element's identity. */
export type Dependents = (identity: string) => readonly GraphDependency[];

/** The Dependencies on one Element of a Service that narrowing it to a Visibility leaves without reach. */
export type LosingReach = (identity: string, to: Visibility) => readonly GraphDependency[];

/**
 * Every Dependency on an Element of a Service, sorted by package name, then version; a Dependency
 * on another Service's Element of the same identity is none.
 */
export function dependenciesOn(
  graph: DependencyGraph,
  service: string,
  element: Dependable,
): readonly GraphDependency[] {
  const dependingPackages = graph.filter(({ dependencies }) => {
    return Object.hasOwn(dependencies, service) && dependsOn(dependencies[service], element);
  });
  return dependingPackages
    .map(({ name, version }) => ({ name, version }))
    .sort((left, right) => {
      return (
        byCodePoint(left.name, right.name) || compareSemanticVersions(left.version, right.version)
      );
    });
}

/**
 * Every Dependency on an Element of a Service whose package may not target it at its narrowed
 * Visibility, sorted as `dependenciesOn` sorts them.
 */
export function dependenciesLosingReach(
  graph: DependencyGraph,
  service: string,
  narrowed: Dependable & { readonly to: Visibility },
): readonly GraphDependency[] {
  const withoutReach = graph.filter(({ kind }) => !reaches(kind, narrowed.to));
  return dependenciesOn(withoutReach, service, narrowed);
}

function dependsOn(dependency: DependencySnapshot | undefined, element: Dependable): boolean {
  if (dependency === undefined) {
    return false;
  }
  switch (element.kind) {
    case 'endpoint':
      return dependency.endpoints.some(({ id }) => id === element.identity);
    case 'event':
      return dependency.events.includes(element.identity);
  }
}
