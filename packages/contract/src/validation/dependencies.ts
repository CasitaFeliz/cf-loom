import {
  type ContractPackage,
  isEndpoint,
  reaches,
  type Visibility,
} from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import {
  type Declarations,
  entriesOf,
  eventServiceOf,
  isPlainObject,
  type LocatedDependency,
  type Root,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

const selection = 'A Dependency selects Elements its Provider exports';

/** An Endpoint a Dependency selected, by its name in code, and where it sits. */
type Selected = { readonly at: Path; readonly name: string; readonly element: unknown };

/**
 * A Dependency holds a Contract Package and is used: it selects Endpoints, or a Subscription
 * receives an Event its Provider exports. A Service reaches the Endpoints its Provider exports,
 * and never a Private one; an Application, outside the network, Public Endpoints only.
 */
export function dependencyFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return declarations.dependencies.flatMap((located) => {
    const { provider } = located.dependency;
    if (!isContractPackage(provider)) {
      const message = `A Dependency's provider is the contract a Contract Package exports`;
      return [failure(located.at, 'dependency-provider', message)];
    }
    return [
      ...endpointFailures(located, provider, declarations.root.kind),
      ...unusedFailures(located, provider, declarations),
    ];
  });
}

/** What a Contract Package's `contract` holds, as far as a Dependency reads it. */
function isContractPackage(provider: unknown): provider is ContractPackage {
  if (!isPlainObject(provider)) {
    return false;
  }
  const { name, version, endpoints, events, standardRejections, exportedSnapshot } = provider;
  const maps = [endpoints, events, standardRejections, exportedSnapshot];
  return typeof name === 'string' && typeof version === 'string' && maps.every(isPlainObject);
}

/** A selection that is no list stays as written; each item of one is judged on its own. */
function endpointFailures(
  { at, dependency }: LocatedDependency,
  provider: ContractPackage,
  rootKind: Root['kind'],
): readonly DeclarationFailure[] {
  const endpointsAt = [...at, 'endpoints'];
  if (!isPlainObject(dependency.endpoints)) {
    return [failure(endpointsAt, 'not-a-list', 'endpoints is a list')];
  }
  const exported = new Set<unknown>(Object.values(provider.endpoints));
  return entriesOf(dependency.endpoints).flatMap(([name, element]) =>
    selectedFailures({ at: [...endpointsAt, name], name, element }, exported, rootKind),
  );
}

function selectedFailures(
  { at, name, element }: Selected,
  exported: ReadonlySet<unknown>,
  rootKind: Root['kind'],
): readonly DeclarationFailure[] {
  if (!isEndpoint(element)) {
    const message = `${selection}: endpoints.${name} is not an Endpoint`;
    return [failure(at, 'dependency-selection', message)];
  }
  const packageKind = rootKind === 'application' ? 'application' : 'service';
  if (!reaches(packageKind, element.visibility)) {
    return [unreachableEndpointFailure({ at, name }, element.visibility)];
  }
  if (!exported.has(element)) {
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

/**
 * A Dependency that selects no Endpoint is used only when it is the one a Subscription receives its
 * Event from; a selection that is no list is reported as such, and not also as unused.
 */
function unusedFailures(
  { at, dependency }: LocatedDependency,
  provider: ContractPackage,
  { root, subscriptions }: Declarations,
): readonly DeclarationFailure[] {
  const selectsEndpoints =
    !isPlainObject(dependency.endpoints) || entriesOf(dependency.endpoints).length > 0;
  const receivesEvents = subscriptions.some(
    ({ subscription }) => eventServiceOf(root, subscription.event) === provider.name,
  );
  if (selectsEndpoints || receivesEvents) {
    return [];
  }
  const message = `A Dependency is used: ${provider.name} gives no Endpoint and no Subscription's Event`;
  return [failure(at, 'unused-dependency', message)];
}
