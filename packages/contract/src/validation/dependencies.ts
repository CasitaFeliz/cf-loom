import type { Path } from '../walker/nodes.ts';
import type { Declarations, LocatedDependencies, Root } from './declarations.ts';
import { isEndpoint } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';

const selection = 'A Dependency selects Elements its Provider exports';

/** A Service reaches Public and Internal Elements; an Application, outside the network, Public only. */
export function dependencyFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { root, dependencies } = declarations;
  return dependencies.flatMap((located) => [
    ...endpointFailures(located, root.kind),
    ...eventFailures(located, root.kind),
  ]);
}

function endpointFailures(
  { at, dependencies }: LocatedDependencies,
  rootKind: Root['kind'],
): readonly DeclarationFailure[] {
  return Object.entries(dependencies.endpoints ?? {}).flatMap(([name, endpoint]) => {
    const endpointAt = [...at, 'endpoints', name];
    if (!isEndpoint(endpoint)) {
      return [
        failure(endpointAt, 'dependency-selection', `${selection}: ${name} is not an Endpoint`),
      ];
    }
    if (endpoint.visibility === 'private') {
      return [failure(endpointAt, 'dependency-selection', `${selection}: ${name} is private`)];
    }
    const selected = { at: endpointAt, name, visibility: endpoint.visibility };
    return rootKind === 'application' ? applicationEndpointFailures(selected) : [];
  });
}

function applicationEndpointFailures({
  at,
  name,
  visibility,
}: {
  readonly at: Path;
  readonly name: string;
  readonly visibility: unknown;
}): readonly DeclarationFailure[] {
  if (visibility === 'public') {
    return [];
  }
  const message = `An Application depends on Public Endpoints only: ${name} is ${String(visibility)}`;
  return [failure(at, 'application-dependency', message)];
}

function eventFailures(
  { at, dependencies }: LocatedDependencies,
  rootKind: Root['kind'],
): readonly DeclarationFailure[] {
  return Object.entries(dependencies.events ?? {}).flatMap(([name, event]) => {
    const eventAt = [...at, 'events', name];
    if (rootKind === 'application') {
      const message = `An Application subscribes to no Event: ${name}`;
      return [failure(eventAt, 'application-dependency', message)];
    }
    if (!isEvent(event)) {
      return [failure(eventAt, 'dependency-selection', `${selection}: ${name} is not an Event`)];
    }
    const visibility: unknown = event.visibility;
    if (visibility === 'private') {
      return [failure(eventAt, 'dependency-selection', `${selection}: ${name} is private`)];
    }
    return [];
  });
}

function isEvent(
  value: unknown,
): value is { readonly kind: 'event'; readonly visibility: unknown } {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'event';
}
