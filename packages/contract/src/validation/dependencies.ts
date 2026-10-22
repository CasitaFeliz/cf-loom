import { isEndpoint, isEvent, reaches, type Visibility } from '../declarations/index.ts';
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
 * outside the network, Public Endpoints only. A Dependency lists only Events a Subscription uses.
 */
export function dependencyFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { root, dependencies, subscriptions } = declarations;
  const subscribed = new Set(subscriptions.map(({ subscription }) => subscription.event));
  return dependencies.flatMap((located) => {
    const exported = exportedOf(located);
    return [
      ...selectedOf(located, 'endpoints').flatMap((selected) =>
        selectedEndpointFailures(selected, exported, root.kind),
      ),
      ...selectedOf(located, 'events').flatMap((selected) =>
        eventFailures(selected, { exported, rootKind: root.kind, subscribed }),
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
  readonly events: ReadonlySet<unknown> | undefined;
};

function exportedOf({ dependencies }: LocatedDependencies): Exported {
  const exported: Partial<Record<'endpoints' | 'events', unknown>> = partOf(dependencies.exported);
  return {
    endpoints: isPlainObject(exported.endpoints)
      ? new Set(Object.values(exported.endpoints))
      : undefined,
    events: isPlainObject(exported.events) ? new Set(Object.values(exported.events)) : undefined,
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
  const packageKind = rootKind === 'application' ? 'application' : 'service';
  if (!reaches(packageKind, element.visibility)) {
    return [unreachableEndpointFailure({ at, name }, element.visibility)];
  }
  if (exported.endpoints !== undefined && !exported.endpoints.has(element)) {
    return [failure(at, 'dependency-selection', `${selection}: ${name} is not one of them`)];
  }
  return [];
}

/** A Private Endpoint is nobody's to select; an Internal one is a Service's only, never an Application's. */
function unreachableEndpointFailure(
  { at, name }: Pick<Selected, 'at' | 'name'>,
  visibility: Visibility,
): DeclarationFailure {
  if (visibility === 'private') {
    return failure(at, 'dependency-selection', `${selection}: ${name} is private`);
  }
  const message = `An Application depends on Public Endpoints only: ${name} is ${textOf(visibility)}`;
  return failure(at, 'application-dependency', message);
}

/** What a Dependency's selected Event is judged against: its Provider's exports, its root and the Events subscribed to. */
type EventContext = {
  readonly exported: Exported;
  readonly rootKind: Root['kind'];
  readonly subscribed: ReadonlySet<unknown>;
};

/** An Event that fails selection is not also reported as unused: one cause, once. */
function eventFailures(selected: Selected, context: EventContext): readonly DeclarationFailure[] {
  const failures = selectedEventFailures(selected, context.exported, context.rootKind);
  if (failures.length > 0) {
    return failures;
  }
  return unusedEventFailures(selected, context.subscribed);
}

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
  if (!reaches('service', element.visibility)) {
    return [failure(at, 'dependency-selection', `${selection}: ${name} is private`)];
  }
  if (exported.events !== undefined && !exported.events.has(element)) {
    return [failure(at, 'dependency-selection', `${selection}: ${name} is not one of them`)];
  }
  return [];
}

/** A Dependency lists an Event only for a Subscription, since a Dependency names only what its owner uses. */
function unusedEventFailures(
  { at, name, element }: Selected,
  subscribed: ReadonlySet<unknown>,
): readonly DeclarationFailure[] {
  if (subscribed.has(element)) {
    return [];
  }
  const message = `A Dependency lists only Events a Subscription uses: ${name}`;
  return [failure(at, 'unused-dependency-event', message)];
}
