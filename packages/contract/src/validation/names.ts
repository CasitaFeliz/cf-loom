import type { Endpoint } from '../declarations/index.ts';
import { isEndpoint } from '../declarations/index.ts';
import type { Declarations } from './declarations.ts';
import { endpointAt } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { identityOf } from './identity.ts';
import type { LocatedEndpoint, LocatedGroup, Root } from './located.ts';
import { isCanonicalPath } from './paths.ts';
import { listOf, textOf } from './written.ts';

/**
 * A root is named as its package.json without the scope, so its Contract Package's name follows
 * from it; a name that is no string is another rule's.
 */
export function packageNameFailures(
  root: Root,
  packageName: string,
): readonly DeclarationFailure[] {
  if (typeof root.name !== 'string' || root.name === packageName) {
    return [];
  }
  const message = `A root is named as its package.json, without the scope: ${packageName}`;
  return [failure(['name'], 'package-name', message)];
}

/** Definitions Package and Group names, Endpoint names not Retired, Endpoint identities, Guard names and Providers are each unique. */
export function uniquenessFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return [
    ...uniqueDefinitionsNames(declarations),
    ...uniqueGroupNames(declarations),
    ...uniqueEndpointNames(declarations),
    ...uniqueEndpointIdentities(declarations),
    ...uniqueGuardNames(declarations),
    ...uniqueProviders(declarations),
  ];
}

function uniqueDefinitionsNames({
  listedDefinitions,
}: Declarations): readonly DeclarationFailure[] {
  const nameOf = (located: Declarations['listedDefinitions'][number]) =>
    textOf(located.definitions.name);
  return repeated(listedDefinitions, nameOf).map(({ at, definitions }) =>
    failure(
      [...at, 'name'],
      'duplicate-definitions-name',
      `A Contract lists each Definitions Package once, under a name of its own: ${textOf(definitions.name)}`,
    ),
  );
}

function uniqueGroupNames({ groups }: Declarations): readonly DeclarationFailure[] {
  return repeated(groups, (located) => textOf(located.group.name)).map(({ at, group }) =>
    failure(
      [...at, 'name'],
      'duplicate-group-name',
      `A Group name is unique in the Contract: ${textOf(group.name)}`,
    ),
  );
}

function uniqueEndpointNames({ endpoints }: Declarations): readonly DeclarationFailure[] {
  const active = endpoints.filter((located) => located.endpoint.lifecycle !== 'retired');
  return repeated(active, (located) => textOf(located.endpoint.name)).map(({ at, endpoint }) =>
    failure(
      [...at, 'name'],
      'duplicate-endpoint-name',
      `An Endpoint name is unique among the Endpoints that are not Retired: ${textOf(endpoint.name)}`,
    ),
  );
}

function uniqueEndpointIdentities({ endpoints }: Declarations): readonly DeclarationFailure[] {
  const identified = endpoints.filter((located) => isCanonicalPath(located.endpoint.path));
  return repeated(identified, identityOfEndpoint).map((located) =>
    failure(
      [...located.at, 'path'],
      'duplicate-endpoint-identity',
      `An Endpoint is identified by its method and path, once: ${identityOfEndpoint(located)}`,
    ),
  );
}

function uniqueGuardNames({ guards }: Declarations): readonly DeclarationFailure[] {
  return repeated(guards, (located) => textOf(located.guard.name)).map(({ at, guard }) =>
    failure(
      [...at, 'name'],
      'duplicate-guard-name',
      `A Guard name is unique across the Contract and its Definitions Packages: ${textOf(guard.name)}`,
    ),
  );
}

function uniqueProviders({ dependencies }: Declarations): readonly DeclarationFailure[] {
  const providerOf = (located: Declarations['dependencies'][number]) =>
    textOf(located.dependencies.provider);
  return repeated(dependencies, providerOf).map(({ at, dependencies: listed }) =>
    failure(
      at,
      'duplicate-dependency',
      `A Contract lists one Dependency per Provider: ${textOf(listed.provider)}`,
    ),
  );
}

/** Every Group lists at least one Endpoint, and every Endpoint is in exactly one Group. */
export function groupFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const groupByEndpoint = new Map<Endpoint, LocatedGroup>();
  const failures: DeclarationFailure[] = [];
  for (const located of declarations.groups) {
    const endpoints = listOf(located.group.endpoints).filter(isEndpoint);
    if (Array.isArray(located.group.endpoints) && located.group.endpoints.length === 0) {
      const message = 'A Group lists at least one Endpoint';
      failures.push(failure([...located.at, 'endpoints'], 'empty-group', message));
    }
    for (const endpoint of endpoints) {
      failures.push(...membershipFailures(endpoint, located, groupByEndpoint));
      groupByEndpoint.set(endpoint, groupByEndpoint.get(endpoint) ?? located);
    }
  }
  return failures;
}

function membershipFailures(
  endpoint: Endpoint,
  located: LocatedGroup,
  groupByEndpoint: ReadonlyMap<Endpoint, LocatedGroup>,
): readonly DeclarationFailure[] {
  const first = groupByEndpoint.get(endpoint);
  if (first === undefined) {
    return [];
  }
  const at = endpointAt(located.at, endpoint);
  const message = `An Endpoint belongs to exactly one Group: ${textOf(endpoint.name)} is also in ${textOf(first.group.name)}`;
  return [failure(at, 'group-membership', message)];
}

function identityOfEndpoint({ endpoint }: LocatedEndpoint): string {
  return identityOf(endpoint.method, endpoint.path);
}

/** Every item after the first with the same key, in order, so each repeat is reported once. */
function repeated<Item>(items: readonly Item[], keyOf: (item: Item) => string): readonly Item[] {
  const seen = new Set<string>();
  const repeats: Item[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) {
      repeats.push(item);
    }
    seen.add(key);
  }
  return repeats;
}
