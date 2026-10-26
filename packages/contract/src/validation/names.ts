import { isLive, type Root } from '../declarations/index.ts';
import {
  type Declarations,
  identityOf,
  type LocatedDependency,
  type LocatedEndpoint,
  packageNamePartsOf,
  providerNameOf,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { isCanonicalPath } from './paths.ts';

/**
 * A Service or an Application is named as its package.json without the scope, so its Contract
 * Package's name follows from it; a Definitions Package has no name but its package.json's, and a
 * name that is no string is another rule's.
 */
export function packageNameFailures(
  root: Root,
  packageName: string,
): readonly DeclarationFailure[] {
  const unscoped = packageNamePartsOf(packageName).name;
  if (root.kind === 'definitions' || typeof root.name !== 'string' || root.name === unscoped) {
    return [];
  }
  const message = `A root is named as its package.json, without the scope: ${unscoped}`;
  return [failure(['name'], 'package-name', message)];
}

/** Group names, Endpoint names not Retired, Endpoint identities, Guard names and Providers are each unique. */
export function uniquenessFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return [
    ...uniqueGroupNames(declarations),
    ...uniqueEndpointNames(declarations),
    ...uniqueEndpointIdentities(declarations),
    ...uniqueGuardNames(declarations),
    ...uniqueProviders(declarations),
  ];
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
  const active = endpoints.filter((located) => isLive(located.endpoint));
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

/** A Dependency whose provider has no name is the Dependency rule's, and repeats no other. */
function uniqueProviders({ dependencies }: Declarations): readonly DeclarationFailure[] {
  const providerOf = ({ dependency }: LocatedDependency) => providerNameOf(dependency);
  const named = dependencies.filter((located) => providerOf(located) !== undefined);
  return repeated(named, (located) => textOf(providerOf(located))).map((located) =>
    failure(
      located.at,
      'duplicate-dependency',
      `A Contract lists one Dependency per Provider: ${textOf(providerOf(located))}`,
    ),
  );
}

function identityOfEndpoint({ endpoint }: LocatedEndpoint): string {
  return identityOf(endpoint.method, endpoint.path);
}

/** Every item after the first with the same key, in order, so each repeat is reported once. */
export function repeated<Item>(
  items: readonly Item[],
  keyOf: (item: Item) => string,
): readonly Item[] {
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
