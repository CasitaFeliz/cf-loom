import { isGuard } from '../predicates.ts';
import type { Path } from '../walker/nodes.ts';
import type { Declarations } from './declarations.ts';
import { listOf, standardRejectionEntriesOf } from './declarations.ts';
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

/** An object an author wrote, where it sits, and the fields its kind declares. */
type Written = { readonly at: Path; readonly value: unknown; readonly fields: KnownFields };

/** Every object an author writes holds only the fields its kind declares and every one it requires. */
export function fieldFailures(declarations: Declarations): readonly DeclarationFailure[] {
  return writtenOf(declarations).flatMap((written) => [
    ...undeclaredFailures(written),
    ...requiredFailures(written),
  ]);
}

function writtenOf(declarations: Declarations): readonly Written[] {
  const { root, packages, groups, definitions, endpoints, guards, rejections, dependencies } =
    declarations;
  return [
    { at: [], value: root, fields: rootFields[root.kind] },
    ...definitions.map(({ at, definitions: listed }) => written(at, listed, definitionsFields)),
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
    ...packages.flatMap(standardRejectionsOf),
  ];
}

function attachmentsOf(at: Path, attachments: unknown): readonly Written[] {
  return listOf(attachments as readonly unknown[] | undefined)
    .map((attachment, index) => written([...at, 'guards', index], attachment, attachmentFields))
    .filter(({ value }) => !isGuard(value));
}

/** The `standardRejections` map of a Definitions Package and each declaration in it. */
function standardRejectionsOf({
  at,
  definitions,
}: Declarations['packages'][number]): readonly Written[] {
  const mapAt = [...at, 'standardRejections'];
  return [
    written(mapAt, definitions.standardRejections, standardRejectionsFields),
    ...standardRejectionEntriesOf(definitions).map(([name, declaration]) =>
      written([...mapAt, name], declaration, standardRejectionFields),
    ),
  ];
}

function written(at: Path, value: unknown, fields: KnownFields): Written {
  return { at, value, fields };
}

function undeclaredFailures({ at, value, fields }: Written): readonly DeclarationFailure[] {
  if (!isWrittenObject(value)) {
    return [];
  }
  const undeclared = Object.keys(value).filter((field) => !Object.hasOwn(fields.declared, field));
  return undeclared.map((field) =>
    failure([...at, field], 'undeclared-field', `${field} is not a declared field`),
  );
}

/** A required field is present, `null` counting as missing; a string field present is a string. */
function requiredFailures({ at, value, fields }: Written): readonly DeclarationFailure[] {
  if (!isWrittenObject(value)) {
    return [];
  }
  const missing = Object.keys(fields.required).filter((field) => isMissing(value[field]));
  const notStrings = Object.keys(fields.strings).filter(
    (field) => !isMissing(value[field]) && typeof value[field] !== 'string',
  );
  return [
    ...missing.map((field) =>
      failure(
        [...at, field],
        'required-field',
        Object.hasOwn(fields.strings, field)
          ? `${field} is a required string`
          : `${field} is a required field`,
      ),
    ),
    ...notStrings.map((field) => failure([...at, field], 'not-a-string', `${field} is a string`)),
  ];
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null;
}

/** What an author writes as an object; a list or anything else is the structure rule's finding. */
function isWrittenObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
