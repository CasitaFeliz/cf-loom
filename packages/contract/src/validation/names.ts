import type { Endpoint } from '../endpoint.ts';
import type { Path } from '../walker/nodes.ts';
import type { Declarations, LocatedEndpoint, LocatedGroup } from './declarations.ts';
import { listOf } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { identityOf, isCanonicalPath } from './paths.ts';

/** A grammar a kind of name follows, so it is safe in code, subjects and broker names. */
type Grammar = { readonly name: string; readonly pattern: RegExp };

const kebabCase: Grammar = { name: 'kebab-case', pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/ };
const camelCase: Grammar = { name: 'camelCase', pattern: /^[a-z][a-zA-Z0-9]*$/ };
const upperSnakeCase: Grammar = {
  name: 'UPPER_SNAKE_CASE',
  pattern: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/,
};

/** A name as declared, where it sits, and what the sentence calls it: `A Group name`. */
type Named = { readonly at: Path; readonly value: unknown; readonly noun: string };

/** Every name of a root follows the grammar of its kind. */
export function nameFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { root, groups, definitions, endpoints, guards, rejections, standardRejections } =
    declarations;
  const kebab = [
    { at: ['name'], value: root.name, noun: rootNoun(root.kind) },
    ...named(definitions, (listed) => listed.definitions.name, 'A Definitions Package name'),
    ...named(groups, (listed) => listed.group.name, 'A Group name'),
  ];
  const camel = [
    ...named(endpoints, (listed) => listed.endpoint.name, 'An Endpoint name'),
    ...named(guards, (listed) => listed.guard.name, 'A Guard name'),
  ];
  const upperSnake = [
    ...codes(rejections, (listed) => listed.rejection.code),
    ...codes(standardRejections, (listed) => listed.declaration.code),
  ];
  return [
    ...grammarFailures(kebab, kebabCase),
    ...grammarFailures(camel, camelCase),
    ...grammarFailures(upperSnake, upperSnakeCase),
  ];
}

function named<Located extends { readonly at: Path }>(
  list: readonly Located[],
  nameOf: (located: Located) => unknown,
  noun: string,
): readonly Named[] {
  return list.map((located) => ({ at: [...located.at, 'name'], value: nameOf(located), noun }));
}

function codes<Located extends { readonly at: Path }>(
  list: readonly Located[],
  codeOf: (located: Located) => unknown,
): readonly Named[] {
  return list.map((located) => ({
    at: [...located.at, 'code'],
    value: codeOf(located),
    noun: 'A Rejection code',
  }));
}

/** Endpoint names that are not Retired, Endpoint identities and Guard names are each unique. */
export function uniquenessFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { endpoints, guards } = declarations;
  const active = endpoints.filter((located) => located.endpoint.lifecycle !== 'retired');
  const repeatedNames = repeated(active, (located) => located.endpoint.name);
  const identified = endpoints.filter((located) => isCanonicalPath(located.endpoint.path));
  const repeatedIdentities = repeated(identified, identityOfEndpoint);
  const repeatedGuards = repeated(guards, (located) => located.guard.name);
  return [
    ...repeatedNames.map(({ at, endpoint }) =>
      failure(
        [...at, 'name'],
        'duplicate-endpoint-name',
        `An Endpoint name is unique among the Endpoints that are not Retired: ${endpoint.name}`,
      ),
    ),
    ...repeatedIdentities.map((located) =>
      failure(
        [...located.at, 'path'],
        'duplicate-endpoint-identity',
        `An Endpoint is identified by its method and path, once: ${identityOfEndpoint(located)}`,
      ),
    ),
    ...repeatedGuards.map(({ at, guard }) =>
      failure(
        [...at, 'name'],
        'duplicate-guard-name',
        `A Guard name is unique across the Contract and its Definitions Packages: ${guard.name}`,
      ),
    ),
  ];
}

/** Every Group lists at least one Endpoint, and every Endpoint is in exactly one Group. */
export function groupFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const groupByEndpoint = new Map<Endpoint, LocatedGroup>();
  const failures: DeclarationFailure[] = [];
  for (const located of declarations.groups) {
    const endpoints = listOf(located.group.endpoints);
    if (endpoints.length === 0) {
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
  const at = [...located.at, 'endpoints', endpoint.name];
  const message = `An Endpoint belongs to exactly one Group: ${endpoint.name} is also in ${first.group.name}`;
  return [failure(at, 'group-membership', message)];
}

function grammarFailures(named: readonly Named[], grammar: Grammar): readonly DeclarationFailure[] {
  const breaking = named.filter(
    ({ value }) => typeof value !== 'string' || !grammar.pattern.test(value),
  );
  return breaking.map(({ at, value, noun }) =>
    failure(at, 'name-grammar', `${noun} is ${grammar.name}: ${String(value)}`),
  );
}

function rootNoun(kind: Declarations['root']['kind']): string {
  switch (kind) {
    case 'contract':
      return 'A Service name';
    case 'application':
      return 'An Application name';
    case 'definitions':
      return 'A Definitions Package name';
  }
}

function identityOfEndpoint({ endpoint }: LocatedEndpoint): string {
  return identityOf(endpoint.method, String(endpoint.path));
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
