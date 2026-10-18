import { isGuard } from '../predicates.ts';
import type { Path } from '../walker/nodes.ts';
import type { Declarations } from './declarations.ts';
import { listOf } from './declarations.ts';
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
    .filter((entry) => !isGuard(entry.value));
}

/** The `standardRejections` map of a Definitions Package and each declaration in it. */
function standardRejectionsOf({
  at,
  definitions,
}: Declarations['packages'][number]): readonly Written[] {
  const map = definitions.standardRejections;
  const mapAt = [...at, 'standardRejections'];
  const entries = typeof map === 'object' && map !== null ? Object.entries(map) : [];
  return [
    written(mapAt, map, standardRejectionsFields),
    ...entries.map(([name, declaration]) =>
      written([...mapAt, name], declaration, standardRejectionFields),
    ),
  ];
}

function written(at: Path, value: unknown, fields: KnownFields): Written {
  return { at, value, fields };
}

function undeclaredFailures({ at, value, fields }: Written): readonly DeclarationFailure[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const undeclared = Object.keys(value).filter((field) => !Object.hasOwn(fields.declared, field));
  return undeclared.map((field) =>
    failure([...at, field], 'undeclared-field', `${field} is not a declared field`),
  );
}

function requiredFailures({ at, value, fields }: Written): readonly DeclarationFailure[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const present = value as Readonly<Record<string, unknown>>;
  const missing = fields.required.filter((field) => present[field] === undefined);
  const notStrings = fields.strings.filter(
    (field) => present[field] !== undefined && typeof present[field] !== 'string',
  );
  return [...missing, ...notStrings].map((field) =>
    failure(
      [...at, field],
      'required-field',
      fields.strings.includes(field)
        ? `${field} is a required string`
        : `${field} is a required field`,
    ),
  );
}
