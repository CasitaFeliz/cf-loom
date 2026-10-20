import { isEndpoint, isEvent } from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import {
  type Declarations,
  entriesOf,
  isPlainObject,
  type LocatedDependencies,
  partOf,
  type Root,
  textOf,
} from '../written/index.ts';
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
  return dependencies.flatMap((located) => {
    const exported = exportedOf(located);
    return [
      ...selectedOf(located, 'endpoints').flatMap((selected) =>
        selectedEndpointFailures(selected, exported, root.kind),
      ),
      ...selectedOf(located, 'events').flatMap((selected) =>
        selectedEventFailures(selected, exported, root.kind),
      ),
    ];
  });
}

function selectedOf(
  { at, dependencies }: LocatedDependencies,
  part: 'endpoints' | 'events',
): readonly Selected[] {
  return entriesOf(dependencies[part]).map(([name, element]) => ({
    at: [...at, part, name],
    name,
    element,
  }));
}

/**
 * The Elements a Dependency's Provider exports, read once per Dependency; a map that is no object
 * is the field rules' finding, and nothing is judged against it.
 */
type Exported = {
  readonly endpoints: ReadonlySet<unknown> | undefined;
  readonly events: readonly unknown[] | undefined;
};

function exportedOf({ dependencies }: LocatedDependencies): Exported {
  const exported: Partial<Record<'endpoints' | 'events', unknown>> = partOf(dependencies.exported);
  return {
    endpoints: isPlainObject(exported.endpoints)
      ? new Set(Object.values(exported.endpoints))
      : undefined,
    events: isPlainObject(exported.events) ? Object.values(exported.events) : undefined,
  };
}

function selectedEndpointFailures(
  { at, name, element }: Selected,
  exported: Exported,
  rootKind: Root['kind'],
): readonly DeclarationFailure[] {
  if (!isEndpoint(element)) {
    return [failure(at, 'dependency-selection', `${selection}: ${name} is not an Endpoint`)];
  }
  if (element.visibility === 'private') {
    return [failure(at, 'dependency-selection', `${selection}: ${name} is private`)];
  }
  if (exported.endpoints !== undefined && !exported.endpoints.has(element)) {
    return [failure(at, 'dependency-selection', `${selection}: ${name} is not one of them`)];
  }
  if (rootKind !== 'application' || element.visibility === 'public') {
    return [];
  }
  const message = `An Application depends on Public Endpoints only: ${name} is ${textOf(element.visibility)}`;
  return [failure(at, 'application-dependency', message)];
}

/**
 * An Event is one the Provider exports when it has the same name and version: a Contract
 * Package's Events are plain objects until `defineEvent` brands them (milestone 2), and a
 * declaration copies plain objects, so identity cannot tell them apart.
 */
function selectedEventFailures(
  { at, name, element }: Selected,
  exported: Exported,
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
  const isExported = (exported.events ?? [element]).some(
    (event) => isEvent(event) && event.name === element.name && event.version === element.version,
  );
  return isExported
    ? []
    : [failure(at, 'dependency-selection', `${selection}: ${name} is not one of them`)];
}
