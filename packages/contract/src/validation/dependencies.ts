import { isEndpoint, isEvent } from '../predicates.ts';
import type { Path } from '../walker/nodes.ts';
import type { Declarations, LocatedDependencies, Root } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';

const selection = 'A Dependency selects Elements its Provider exports';

/** An Element a Dependency selected, by its name in code, and where it sits. */
type Selected = { readonly at: Path; readonly name: string; readonly element: unknown };

/**
 * A Service reaches the Elements its Provider exports, and never a Private one; an Application,
 * outside the network, Public Endpoints only.
 */
export function dependencyFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { root, dependencies } = declarations;
  return dependencies.flatMap((located) => [
    ...selectedOf(located, 'endpoints').flatMap((selected) =>
      endpointFailures(selected, located, root.kind),
    ),
    ...selectedOf(located, 'events').flatMap((selected) =>
      eventFailures(selected, located, root.kind),
    ),
  ]);
}

function selectedOf(
  { at, dependencies }: LocatedDependencies,
  part: 'endpoints' | 'events',
): readonly Selected[] {
  const elements: object = dependencies[part] ?? {};
  return Object.entries(elements).map(([name, element]) => ({
    at: [...at, part, name],
    name,
    element,
  }));
}

function endpointFailures(
  { at, name, element }: Selected,
  { dependencies }: LocatedDependencies,
  rootKind: Root['kind'],
): readonly DeclarationFailure[] {
  if (!isEndpoint(element)) {
    return [failure(at, 'dependency-selection', `${selection}: ${name} is not an Endpoint`)];
  }
  if (element.visibility === 'private') {
    return [failure(at, 'dependency-selection', `${selection}: ${name} is private`)];
  }
  const exported: object = dependencies.exported?.endpoints ?? {};
  if (!Object.values(exported).includes(element)) {
    return [failure(at, 'dependency-selection', `${selection}: ${name} is not one of them`)];
  }
  if (rootKind !== 'application' || element.visibility === 'public') {
    return [];
  }
  const message = `An Application depends on Public Endpoints only: ${name} is ${String(element.visibility)}`;
  return [failure(at, 'application-dependency', message)];
}

/**
 * An Event is one the Provider exports when it has the same name and version: a Contract
 * Package's Events are plain objects until `defineEvent` brands them (milestone 2), and a
 * declaration copies plain objects, so identity cannot tell them apart.
 */
function eventFailures(
  { at, name, element }: Selected,
  { dependencies }: LocatedDependencies,
  rootKind: Root['kind'],
): readonly DeclarationFailure[] {
  if (rootKind === 'application') {
    return [
      failure(at, 'application-dependency', `An Application subscribes to no Event: ${name}`),
    ];
  }
  if (!isEvent(element)) {
    return [failure(at, 'dependency-selection', `${selection}: ${name} is not an Event`)];
  }
  if (element.visibility === 'private') {
    return [failure(at, 'dependency-selection', `${selection}: ${name} is private`)];
  }
  const exported: object = dependencies.exported?.events ?? {};
  const isExported = Object.values(exported).some(
    (event) => isEvent(event) && event.name === element.name && event.version === element.version,
  );
  return isExported
    ? []
    : [failure(at, 'dependency-selection', `${selection}: ${name} is not one of them`)];
}
