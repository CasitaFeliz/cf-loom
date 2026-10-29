import { isDeclaration, undeclaredFieldSentence } from '../declarations/index.ts';
import { fieldStep, indexStep, inFields, inside, type Place, placeOf } from '../walker/index.ts';
import {
  type Declarations,
  isMissing,
  isPlainObject,
  isWithoutValue,
  listOf,
  type NamedDefinitions,
  standardRejectionsDeclarerOf,
  type WrittenObject,
} from '../written/index.ts';
import type { KnownFields } from './declared-fields.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import {
  attachmentFields,
  demandsFields,
  endpointFields,
  guardFields,
  inputFields,
  rejectionFields,
  standardRejectionFields,
  standardRejectionsFields,
  successFields,
} from './field-tables.ts';
import {
  commandFields,
  definitionsFields,
  dependencyFields,
  eventFields,
  groupFields,
  rootFields,
  subscriptionFields,
} from './root-field-tables.ts';

/** An object an author wrote, where it sits, and the fields its kind declares. */
export type Written = { readonly at: Place; readonly value: unknown; readonly fields: KnownFields };

/** A written object the rules can read field by field. */
export type Readable = Written & { readonly value: WrittenObject };

/** Every object an author writes holds only the fields its kind declares, every one it requires, strings where typed so, and no blank `description` or `message`. */
export function fieldFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return readableOf(declarations).flatMap((written) => [
    ...undeclaredFailures(written),
    ...requiredFailures(written),
    ...stringFailures(written),
    ...blankFailures(written),
  ]);
}

/** Every object an author wrote that the field rules can read, with its kind's fields. */
export function readableOf(declarations: Declarations): readonly Readable[] {
  return writtenOf(declarations).filter(isReadable);
}

function writtenOf(declarations: Declarations): readonly Written[] {
  return [
    ...contractWrittenOf(declarations),
    ...elementsWrittenOf(declarations),
    ...standardsWrittenOf(declarations),
    ...messagingWrittenOf(declarations),
  ];
}

/** The Root, the Definitions object it names for its Standard Rejections, and its Groups. */
function contractWrittenOf(declarations: Declarations): readonly Written[] {
  const { root, standardRejectionsSource, groups } = declarations;
  return [
    { at: placeOf({ kind: 'root' }, root), value: root, fields: rootFields[root.kind] },
    ...(standardRejectionsSource === undefined
      ? []
      : [
          written(
            standardRejectionsSource.at,
            standardRejectionsSource.definitions,
            definitionsFields,
          ),
        ]),
    ...groups.map(({ at, group }) => written(at, group, groupFields)),
  ];
}

/** The Endpoints, Guards, Rejections and Dependencies, each with the objects it holds. */
function elementsWrittenOf(declarations: Declarations): readonly Written[] {
  const { endpoints, guards, rejections, dependencies } = declarations;
  return [
    ...endpoints.flatMap(({ at, endpoint }) => [
      written(at, endpoint, endpointFields),
      written(inFields(at, 'input'), endpoint.input, inputFields),
      written(inFields(at, 'success'), endpoint.success, successFields),
      ...attachmentsOf(at, endpoint.guards),
    ]),
    ...guards.flatMap(({ at, guard }) => [
      written(at, guard, guardFields),
      written(inFields(at, 'demands'), guard.demands, demandsFields),
    ]),
    ...rejections.map(({ at, rejection }) => written(at, rejection, rejectionFields)),
    ...dependencies.map(({ at, dependency }) => written(at, dependency, dependencyFields)),
  ];
}

/** The `standardRejections` map of the package that declares them, and each declaration in it. */
function standardsWrittenOf(declarations: Declarations): readonly Written[] {
  const declarer = standardRejectionsDeclarerOf(declarations);
  return [
    ...(declarer === undefined ? [] : [standardRejectionsMapOf(declarer)]),
    ...declarations.standardRejections.map(({ at, declaration }) =>
      written(at, declaration, standardRejectionFields),
    ),
  ];
}

/** The Message Versions and Subscriptions a Contract lists. */
function messagingWrittenOf({ events, commands, subscriptions }: Declarations): readonly Written[] {
  return [
    ...events.map(({ at, event }) => written(at, event, eventFields)),
    ...commands.map(({ at, command }) => written(at, command, commandFields)),
    ...subscriptions.map(({ at, subscription }) => written(at, subscription, subscriptionFields)),
  ];
}

/**
 * A qualified Attachment is a plain object that is no declaration: a declaration here is no
 * Attachment, which the Attachment rule reports once.
 */
function attachmentsOf(at: Place, attachments: unknown): readonly Written[] {
  return listOf(attachments)
    .map((attachment, index) =>
      written(inside(at, fieldStep('guards'), indexStep(index)), attachment, attachmentFields),
    )
    .filter(({ value }) => isPlainObject(value) && !isDeclaration(value));
}

/** The `standardRejections` map of a Definitions Package, whose declarations are written apart. */
function standardRejectionsMapOf({ at, definitions }: NamedDefinitions): Written {
  const mapAt = inFields(at, 'standardRejections');
  return written(mapAt, definitions.standardRejections, standardRejectionsFields);
}

function written(at: Place, value: unknown, fields: KnownFields): Written {
  return { at, value, fields };
}

function undeclaredFailures({ at, value, fields }: Readable): readonly DeclarationFailure[] {
  const undeclared = Object.keys(value).filter((field) => !Object.hasOwn(fields.declared, field));
  return undeclared.map((field) =>
    failure(inFields(at, field), 'undeclared-field', undeclaredFieldSentence(field)),
  );
}

/** A required field has a value; written `null` or left out, it has none. */
function requiredFailures({ at, value, fields }: Readable): readonly DeclarationFailure[] {
  const missing = Object.keys(fields.required).filter((field) => isWithoutValue(value[field]));
  return missing.map((field) =>
    failure(
      inFields(at, field),
      'required-field',
      Object.hasOwn(fields.strings, field)
        ? `${field} is a required string`
        : `${field} is a required field`,
    ),
  );
}

/** A field typed as a string holds one when it is not left out; a required one without a value is the required rule's. */
function stringFailures({ at, value, fields }: Readable): readonly DeclarationFailure[] {
  const notStrings = Object.keys(fields.strings).filter((field) => {
    const isRequiredWithoutValue =
      Object.hasOwn(fields.required, field) && isWithoutValue(value[field]);
    return !isRequiredWithoutValue && !isMissing(value[field]) && typeof value[field] !== 'string';
  });
  return notStrings.map((field) =>
    failure(inFields(at, field), 'not-a-string', `${field} is a string`),
  );
}

/** A `description` or a `message` says something: a string of spaces says nothing. */
function blankFailures({ at, value, fields }: Readable): readonly DeclarationFailure[] {
  const blank = Object.keys(fields.nonBlank).filter((field) => {
    const text = value[field];
    return typeof text === 'string' && text.trim() === '';
  });
  return blank.map((field) =>
    failure(inFields(at, field), 'blank-text', `A ${field} is never blank`),
  );
}

/** What is written as no object is the structure rule's finding. */
function isReadable(entry: Written): entry is Readable {
  return isPlainObject(entry.value);
}
