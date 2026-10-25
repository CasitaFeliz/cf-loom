import { type ContractPackage, type Endpoint, isEndpoint, reaches } from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import {
  type Declarations,
  eventServiceOf,
  isEmptyField,
  isPlainObject,
  type LocatedDependency,
  listOf,
  type Root,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

const selection = 'A Dependency selects Elements its Provider exports';

/** An Endpoint a Dependency lists and where it sits, by its position in the list. */
type Selected = { readonly at: Path; readonly endpoint: Endpoint };

/**
 * A Dependency holds a Contract Package and is used: it lists Endpoints, or a Subscription
 * receives an Event from its Provider. A Service reaches the Endpoints its Provider exports, each
 * listed once, and never a Private one; an Application, outside the network, Public Endpoints
 * only. What its list holds that is no Endpoint is the structure rule's.
 */
export function dependencyFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return declarations.dependencies.flatMap((located) => {
    const { provider } = located.dependency;
    if (!isContractPackage(provider)) {
      const message = `A Dependency's provider is the contract a Contract Package exports`;
      return [failure(located.at, 'dependency-provider', message)];
    }
    return [
      ...selectedOf(located).flatMap((selected) =>
        selectedFailures(selected, provider, declarations.root.kind),
      ),
      ...repeatedFailures(selectedOf(located)),
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

function selectedOf({ at, dependency }: LocatedDependency): readonly Selected[] {
  const listed = listOf<unknown>(dependency.endpoints).map((endpoint, index) => {
    const listedAt: Path = [...at, 'endpoints', index];
    return { at: listedAt, endpoint };
  });
  return listed.filter(isSelected);
}

function isSelected(listed: { readonly at: Path; readonly endpoint: unknown }): listed is Selected {
  return isEndpoint(listed.endpoint);
}

function selectedFailures(
  { at, endpoint }: Selected,
  provider: ContractPackage,
  rootKind: Root['kind'],
): readonly DeclarationFailure[] {
  const packageKind = rootKind === 'application' ? 'application' : 'service';
  if (!reaches(packageKind, endpoint.visibility)) {
    return [unreachableEndpointFailure(at, endpoint)];
  }
  const exported: readonly unknown[] = Object.values(provider.endpoints);
  if (!exported.includes(endpoint)) {
    const message = `${selection}: ${endpoint.name} is not one of them`;
    return [failure(at, 'dependency-selection', message)];
  }
  return [];
}

/** A Private Endpoint is nobody's to select; an Internal one is a Service's only, never an Application's. */
function unreachableEndpointFailure(at: Path, endpoint: Endpoint): DeclarationFailure {
  const { name, visibility } = endpoint;
  if (visibility === 'private') {
    return failure(at, 'dependency-selection', `${selection}: ${name} is private`);
  }
  const message = `An Application depends on Public Endpoints only: ${name} is ${textOf(visibility)}`;
  return failure(at, 'application-dependency', message);
}

/** Each listing of an Endpoint after its first, in the list's order. */
function repeatedFailures(selected: readonly Selected[]): readonly DeclarationFailure[] {
  const seen = new Set<Endpoint>();
  const failures: DeclarationFailure[] = [];
  for (const { at, endpoint } of selected) {
    if (seen.has(endpoint)) {
      const message = `${selection}: ${endpoint.name} is listed twice`;
      failures.push(failure(at, 'dependency-selection', message));
    }
    seen.add(endpoint);
  }
  return failures;
}

/** A Dependency that lists no Endpoint is used only when a Subscription receives its Event from it. */
function unusedFailures(
  { at, dependency }: LocatedDependency,
  provider: ContractPackage,
  { root, subscriptions }: Declarations,
): readonly DeclarationFailure[] {
  const receivesEvents = subscriptions.some(
    ({ subscription }) => eventServiceOf(root, subscription.event) === provider.name,
  );
  if (!isEmptyField(dependency.endpoints) || receivesEvents) {
    return [];
  }
  const message = `A Dependency is used: ${provider.name} gives no Endpoint and no Subscription's Event`;
  return [failure(at, 'unused-dependency', message)];
}
