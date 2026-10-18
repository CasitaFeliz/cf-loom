import {
  isDefinitions,
  isDependencies,
  isEndpoint,
  isGroup,
  isGuard,
  isRejection,
  isStandardRejection,
} from '../predicates.ts';
import type { Path } from '../walker/nodes.ts';
import type { Declarations } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/** A field that holds a list of declarations: where it sits, what it holds, and what belongs in it. */
type Listing = {
  readonly at: Path;
  readonly list: unknown;
  readonly noun: string;
  readonly fits: (item: unknown) => boolean;
};

/** Every list is a list and every item in it is the declaration that belongs there. */
export function structureFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return [...listingsOf(declarations).flatMap(listingFailures), ...standardFailures(declarations)];
}

function listingsOf(declarations: Declarations): readonly Listing[] {
  const { root, groups, endpoints, guards, packages } = declarations;
  return [
    ...rootListings(root),
    ...groups.map(({ at, group }) => ({
      at: [...at, 'endpoints'],
      list: group.endpoints,
      noun: 'an Endpoint',
      fits: isEndpoint,
    })),
    ...endpoints.map(({ at, endpoint }) => ({
      at: [...at, 'rejections'],
      list: endpoint.rejections,
      noun: 'a Rejection',
      fits: isListedRejection,
    })),
    ...guards.flatMap(({ at, guard }) => [
      { at: [...at, 'guards'], list: guard.guards, noun: 'a Guard', fits: isGuard },
      {
        at: [...at, 'rejections'],
        list: guard.rejections,
        noun: 'a Rejection',
        fits: isListedRejection,
      },
    ]),
    ...packages.flatMap(({ at, definitions }) => [
      { at: [...at, 'guards'], list: definitions.guards, noun: 'a Guard', fits: isGuard },
      {
        at: [...at, 'rejections'],
        list: definitions.rejections,
        noun: 'a Rejection',
        fits: isRejection,
      },
    ]),
  ];
}

function rootListings(root: Declarations['root']): readonly Listing[] {
  switch (root.kind) {
    case 'contract':
      return [
        {
          at: ['definitions'],
          list: root.definitions,
          noun: 'a Definitions Package',
          fits: isDefinitions,
        },
        { at: ['groups'], list: root.groups, noun: 'a Group', fits: isGroup },
        {
          at: ['dependencies'],
          list: root.dependencies,
          noun: 'a Dependency',
          fits: isDependencies,
        },
      ];
    case 'application':
      return [
        {
          at: ['dependencies'],
          list: root.dependencies,
          noun: 'a Dependency',
          fits: isDependencies,
        },
      ];
    case 'definitions':
      return [];
  }
}

/** Every declared Standard Rejection is an object, as a Definitions Package writes one. */
function standardFailures({ packages }: Declarations): readonly DeclarationFailure[] {
  return packages.flatMap(({ at, definitions }) => {
    const map: object = definitions.standardRejections ?? {};
    return Object.entries(map)
      .filter(([, declaration]) => typeof declaration !== 'object' || declaration === null)
      .map(([name]) =>
        failure(
          [...at, 'standardRejections', name],
          'not-a-declaration',
          `standardRejections.${name} is not a Standard Rejection declaration`,
        ),
      );
  });
}

function listingFailures({ at, list, noun, fits }: Listing): readonly DeclarationFailure[] {
  if (list === undefined) {
    return [];
  }
  const field = String(at.at(-1));
  if (!Array.isArray(list)) {
    return [failure(at, 'not-a-list', `${field} is a list`)];
  }
  const items: readonly unknown[] = list;
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !fits(item))
    .map(({ index }) =>
      failure([...at, index], 'not-a-declaration', `${field}.${index} is not ${noun}`),
    );
}

/** An Endpoint or a Guard lists Rejections; a Standard Rejection is one, judged by its own rule. */
function isListedRejection(item: unknown): boolean {
  return isRejection(item) || isStandardRejection(item);
}
