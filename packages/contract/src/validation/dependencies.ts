import {
  type Endpoint,
  isEndpoint,
  providerOf,
  type Root,
  reaches,
} from '../declarations/index.ts';
import { byCodePoint, fieldStep, indexStep, inside, type Place } from '../walker/index.ts';
import {
  type Declarations,
  isEmptyField,
  type LocatedDependency,
  listOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

const exported = "A Dependency lists Endpoints a Provider's Contract Package exports";

/** An Endpoint a Dependency lists and where it sits, by its position in the list. */
type Selected = { readonly at: Place; readonly endpoint: Endpoint };

/**
 * A Dependency lists one or more Endpoints, all one Provider's, each once: Endpoints a Provider's
 * Contract Package exports, never a Private one, and for an Application, outside the network,
 * Public ones only. What its list holds that is no Endpoint is the structure rule's.
 */
export function dependencyFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const rootKind = declarations.root.kind;
  return declarations.dependencies.flatMap((located) => {
    if (isEmptyField(located.dependency.endpoints)) {
      return [
        failure(located.at, 'dependency-selection', 'A Dependency lists at least one Endpoint'),
      ];
    }
    const selected = selectedOf(located);
    return [
      ...providerFailures(located.at, selected),
      ...selected.flatMap((listed) => selectedFailures(listed, rootKind)),
      ...repeatedFailures(selected),
    ];
  });
}

function selectedOf({ at, dependency }: LocatedDependency): readonly Selected[] {
  const listed = listOf<unknown>(dependency.endpoints).map((endpoint, index) => {
    return { at: inside(at, fieldStep('endpoints'), indexStep(index)), endpoint };
  });
  return listed.filter(isSelected);
}

function isSelected(listed: {
  readonly at: Place;
  readonly endpoint: unknown;
}): listed is Selected {
  return isEndpoint(listed.endpoint);
}

/** The Providers a Dependency's Endpoints name, when more than one: one client calls one base URL. */
function providerFailures(at: Place, selected: readonly Selected[]): readonly DeclarationFailure[] {
  const providers = new Set(selected.map(({ endpoint }) => providerOf(endpoint)));
  providers.delete(undefined);
  if (providers.size < 2) {
    return [];
  }
  const names = [...providers].filter(isName).sort(byCodePoint).join(', ');
  const message = `A Dependency lists one Provider's Endpoints: ${names}`;
  return [failure(at, 'dependency-selection', message)];
}

function isName(provider: string | undefined): provider is string {
  return provider !== undefined;
}

function selectedFailures(
  { at, endpoint }: Selected,
  rootKind: Root['kind'],
): readonly DeclarationFailure[] {
  if (providerOf(endpoint) === undefined) {
    const message = `${exported}: ${endpoint.name} is no Provider's`;
    return [failure(at, 'dependency-selection', message)];
  }
  const packageKind = rootKind === 'application' ? 'application' : 'service';
  if (!reaches(packageKind, endpoint.visibility)) {
    return [unreachableEndpointFailure(at, endpoint)];
  }
  return [];
}

/** A Private Endpoint is nobody's to list; an Internal one is a Service's only, never an Application's. */
function unreachableEndpointFailure(at: Place, endpoint: Endpoint): DeclarationFailure {
  const { visibility } = endpoint;
  if (visibility === 'private') {
    return failure(at, 'dependency-selection', `${exported}: ${labelOf(endpoint)} is private`);
  }
  const message = `An Application depends on Public Endpoints only: ${labelOf(endpoint)} is ${visibility}`;
  return failure(at, 'application-dependency', message);
}

/** Each listing of an Endpoint after its first, in the list's order. */
function repeatedFailures(selected: readonly Selected[]): readonly DeclarationFailure[] {
  const seen = new Set<Endpoint>();
  const failures: DeclarationFailure[] = [];
  for (const { at, endpoint } of selected) {
    if (seen.has(endpoint)) {
      const message = `A Dependency lists each Endpoint once: ${labelOf(endpoint)} is listed twice`;
      failures.push(failure(at, 'dependency-selection', message));
    }
    seen.add(endpoint);
  }
  return failures;
}

/** An Endpoint as a Dependency's failure names it: with its Provider, when one marks it. */
function labelOf(endpoint: Endpoint): string {
  const provider = providerOf(endpoint);
  return provider === undefined ? endpoint.name : `${provider}'s ${endpoint.name}`;
}
