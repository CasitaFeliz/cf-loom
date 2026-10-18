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
import { entriesOf, isPlainObject, listOf, textOf } from './written.ts';

/**
 * A field that holds a list of declarations: where it sits, what it holds, and what belongs in it;
 * a list whose items another rule judges one by one names no `fits`.
 */
type Listing = {
  readonly at: Path;
  readonly list: unknown;
  readonly noun: string;
  readonly fits?: (item: unknown) => boolean;
};

/** A field that holds an object: where it sits, what it holds, and whether its kind requires it. */
type ObjectPart = { readonly at: Path; readonly value: unknown; readonly required: boolean };

/** Every list is a list, every object part an object, and every item the declaration that belongs there. */
export function structureFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return [
    ...listingsOf(declarations).flatMap(listingFailures),
    ...objectPartsOf(declarations).flatMap(objectPartFailures),
    ...standardFailures(declarations),
  ];
}

function listingsOf(declarations: Declarations): readonly Listing[] {
  const { root, groups, endpoints, guards, allPackages } = declarations;
  return [
    ...rootListings(root),
    ...groups.map(({ at, group }) => ({
      at: [...at, 'endpoints'],
      list: group.endpoints,
      noun: 'an Endpoint',
      fits: isEndpoint,
    })),
    ...endpoints.flatMap(({ at, endpoint }) => [
      { at: [...at, 'guards'], list: endpoint.guards, noun: 'an Attachment' },
      {
        at: [...at, 'rejections'],
        list: endpoint.rejections,
        noun: 'a Rejection',
        fits: isListedRejection,
      },
    ]),
    ...guards.flatMap(({ at, guard }) => [
      { at: [...at, 'guards'], list: guard.guards, noun: 'a Guard', fits: isGuard },
      {
        at: [...at, 'rejections'],
        list: guard.rejections,
        noun: 'a Rejection',
        fits: isListedRejection,
      },
    ]),
    ...allPackages.flatMap(({ at, definitions }) => [
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

/** The parts written as objects: an Endpoint's input and success, a Guard's demands, a package's maps. */
function objectPartsOf({ endpoints, guards, allPackages }: Declarations): readonly ObjectPart[] {
  return [
    ...endpoints.flatMap(({ at, endpoint }) => [
      { at: [...at, 'input'], value: endpoint.input, required: false },
      { at: [...at, 'success'], value: endpoint.success, required: true },
    ]),
    ...guards.map(({ at, guard }) => ({
      at: [...at, 'demands'],
      value: guard.demands,
      required: false,
    })),
    ...allPackages.flatMap(({ at, definitions }) => [
      { at: [...at, 'schemas'], value: definitions.schemas, required: false },
      {
        at: [...at, 'standardRejections'],
        value: definitions.standardRejections,
        required: false,
      },
    ]),
  ];
}

/** A missing required part is the required-field rule's; anything else present is an object. */
function objectPartFailures({ at, value, required }: ObjectPart): readonly DeclarationFailure[] {
  if (value === undefined || (value === null && required) || isPlainObject(value)) {
    return [];
  }
  return [failure(at, 'not-an-object', `${textOf(at.at(-1))} is an object`)];
}

/** Every declared Standard Rejection is an object, as a Definitions Package writes one. */
function standardFailures({ allPackages }: Declarations): readonly DeclarationFailure[] {
  return allPackages.flatMap(({ at, definitions }) =>
    entriesOf(definitions.standardRejections)
      .filter(([, declaration]) => !isPlainObject(declaration))
      .map(([name]) =>
        failure(
          [...at, 'standardRejections', name],
          'not-a-declaration',
          `standardRejections.${name} is not a Standard Rejection declaration`,
        ),
      ),
  );
}

function listingFailures({ at, list, noun, fits }: Listing): readonly DeclarationFailure[] {
  if (list === undefined) {
    return [];
  }
  const field = textOf(at.at(-1));
  if (!Array.isArray(list)) {
    return [failure(at, 'not-a-list', `${field} is a list`)];
  }
  if (fits === undefined) {
    return [];
  }
  return listOf(list)
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
