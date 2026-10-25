import {
  isDefinitions,
  isDependency,
  isEndpoint,
  isGroup,
  isGuard,
  isRejection,
  isStandardRejection,
} from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import {
  type Declarations,
  fieldListings,
  groupedFields,
  isPlainObject,
  type LocatedGroup,
  listOf,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { type Readable, readableOf } from './fields.ts';

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
    ...standardsSourceFailures(declarations.root),
    ...listsOf(declarations).flatMap(listingFailures),
    ...readableOf(declarations).flatMap(objectPartsOf).flatMap(objectPartFailures),
  ];
}

/** What a Contract names as `standardRejections`, when it names one, is a Definitions Package's definitions. */
function standardsSourceFailures(root: Declarations['root']): readonly DeclarationFailure[] {
  if (root.kind !== 'contract' || root.standardRejections === undefined) {
    return [];
  }
  if (isDefinitions(root.standardRejections)) {
    return [];
  }
  const message = "A Contract's standardRejections is a Definitions Package's definitions";
  return [failure(['standardRejections'], 'not-a-declaration', message)];
}

function listsOf(declarations: Declarations): readonly Listing[] {
  const { root, groups, endpoints, guards, dependencies } = declarations;
  return [
    ...rootListings(root),
    ...groups.flatMap(groupListings),
    ...dependencies.map(({ at, dependency }) => ({
      at: [...at, 'endpoints'],
      list: dependency.endpoints,
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
  ];
}

/** A Group's lists, none required, since a list left out is empty. */
function groupListings({ at, group }: LocatedGroup): readonly Listing[] {
  return groupedFields.map((field) => ({
    at: [...at, field],
    list: group[field],
    noun: fieldListings[field].noun,
    fits: fieldListings[field].fits,
  }));
}

function rootListings(root: Declarations['root']): readonly Listing[] {
  switch (root.kind) {
    case 'contract':
      return [
        { at: ['groups'], list: root.groups, noun: 'a Group', fits: isGroup },
        {
          at: ['dependencies'],
          list: root.dependencies,
          noun: 'a Dependency',
          fits: isDependency,
        },
      ];
    case 'application':
      return [
        {
          at: ['dependencies'],
          list: root.dependencies,
          noun: 'a Dependency',
          fits: isDependency,
        },
      ];
    case 'definitions':
      return [];
  }
}

/** The parts of a written object its kind types as objects, as the field tables say. */
function objectPartsOf({ at, value, fields }: Readable): readonly ObjectPart[] {
  return Object.keys(fields.objects).map((field) => ({
    at: [...at, field],
    value: value[field],
    required: Object.hasOwn(fields.required, field),
  }));
}

/** A required part without a value is the required-field rule's; anything else present is an object. */
function objectPartFailures({ at, value, required }: ObjectPart): readonly DeclarationFailure[] {
  if (value === undefined || (value === null && required) || isPlainObject(value)) {
    return [];
  }
  return [failure(at, 'not-an-object', `${textOf(at.at(-1))} is an object`)];
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
