import { isDeclaration } from '../freeze-declaration.ts';
import type { Path } from '../walker/nodes.ts';
import type { Declarations } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import {
  attachmentFields,
  definitionsFields,
  demandsFields,
  dependenciesFields,
  endpointFields,
  groupFields,
  guardFields,
  inputFields,
  type KnownFields,
  rejectionFields,
  rootFields,
  standardRejectionFields,
  standardRejectionsFields,
  successFields,
} from './field-tables.ts';
import {
  entriesOf,
  isMissing,
  isPlainObject,
  isWithoutValue,
  listOf,
  type WrittenObject,
} from './written.ts';

/** An object an author wrote, where it sits, and the fields its kind declares. */
export type Written = { readonly at: Path; readonly value: unknown; readonly fields: KnownFields };

/** A written object the rules can read field by field. */
export type Readable = Written & { readonly value: WrittenObject };

/** Every object an author writes holds only the fields its kind declares, every one it requires, and strings where typed so. */
export function fieldFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return readableOf(declarations).flatMap((written) => [
    ...undeclaredFailures(written),
    ...requiredFailures(written),
    ...stringFailures(written),
  ]);
}

/** Every object an author wrote that the field rules can read, with its kind's fields. */
export function readableOf(declarations: Declarations): readonly Readable[] {
  return writtenOf(declarations).filter(isReadable);
}

function writtenOf(declarations: Declarations): readonly Written[] {
  const {
    root,
    allPackages,
    groups,
    listedDefinitions,
    endpoints,
    guards,
    rejections,
    dependencies,
  } = declarations;
  return [
    { at: [], value: root, fields: rootFields[root.kind] },
    ...listedDefinitions.map(({ at, definitions }) => written(at, definitions, definitionsFields)),
    ...groups.map(({ at, group }) => written(at, group, groupFields)),
    ...endpoints.flatMap(({ at, endpoint }) => [
      written(at, endpoint, endpointFields),
      written([...at, 'input'], endpoint.input, inputFields),
      written([...at, 'success'], endpoint.success, successFields),
      ...attachmentsOf(at, endpoint.guards),
    ]),
    ...guards.flatMap(({ at, guard }) => [
      written(at, guard, guardFields),
      written([...at, 'demands'], guard.demands, demandsFields),
    ]),
    ...rejections.map(({ at, rejection }) => written(at, rejection, rejectionFields)),
    ...dependencies.map(({ at, dependencies: listed }) => written(at, listed, dependenciesFields)),
    ...allPackages.flatMap(standardRejectionsOf),
  ];
}

/**
 * A qualified Attachment is a plain object that is no declaration: a declaration here is no
 * Attachment, which the Attachment rule reports once.
 */
function attachmentsOf(at: Path, attachments: unknown): readonly Written[] {
  return listOf(attachments)
    .map((attachment, index) => written([...at, 'guards', index], attachment, attachmentFields))
    .filter(({ value }) => isPlainObject(value) && !isDeclaration(value));
}

/** The `standardRejections` map of a Definitions Package and each declaration in it. */
function standardRejectionsOf({
  at,
  definitions,
}: Declarations['allPackages'][number]): readonly Written[] {
  const mapAt = [...at, 'standardRejections'];
  return [
    written(mapAt, definitions.standardRejections, standardRejectionsFields),
    ...entriesOf(definitions.standardRejections).map(([name, declaration]) =>
      written([...mapAt, name], declaration, standardRejectionFields),
    ),
  ];
}

function written(at: Path, value: unknown, fields: KnownFields): Written {
  return { at, value, fields };
}

function undeclaredFailures({ at, value, fields }: Readable): readonly DeclarationFailure[] {
  const undeclared = Object.keys(value).filter((field) => !Object.hasOwn(fields.declared, field));
  return undeclared.map((field) =>
    failure([...at, field], 'undeclared-field', `${field} is not a declared field`),
  );
}

/** A required field has a value; written `null` or left out, it has none. */
function requiredFailures({ at, value, fields }: Readable): readonly DeclarationFailure[] {
  const missing = Object.keys(fields.required).filter((field) => isWithoutValue(value[field]));
  return missing.map((field) =>
    failure(
      [...at, field],
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
  return notStrings.map((field) => failure([...at, field], 'not-a-string', `${field} is a string`));
}

/** What is written as no object is the structure rule's finding. */
function isReadable(entry: Written): entry is Readable {
  return isPlainObject(entry.value);
}
