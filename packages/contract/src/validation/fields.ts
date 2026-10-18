import type { Path } from '../walker/nodes.ts';
import type { Declarations, Root } from './declarations.ts';
import { isGuard, listOf } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/** An object an author wrote, where it sits, and the fields its kind declares. */
type Written = {
  readonly at: Path;
  readonly value: unknown;
  readonly declared: readonly string[];
};

const rootFields: Record<Root['kind'], readonly string[]> = {
  contract: ['kind', 'name', 'definitions', 'groups', 'dependencies'],
  application: ['kind', 'name', 'dependencies'],
  definitions: ['kind', 'name', 'guards', 'schemas', 'rejections', 'standardRejections'],
};
const groupFields = ['kind', 'name', 'description', 'endpoints'];
const endpointFields = [
  'kind',
  'name',
  'method',
  'path',
  'visibility',
  'description',
  'input',
  'success',
  'guards',
  'rejections',
  'lifecycle',
];
const inputFields = ['params', 'query', 'headers', 'body'];
const successFields = ['status', 'headers', 'body'];
const guardFields = [
  'kind',
  'name',
  'description',
  'demands',
  'guards',
  'context',
  'qualifier',
  'rejections',
];
/** The parts the Guard demands rule judges stay out of this one, so each is reported once. */
const demandsFields = ['headers', 'query', 'params', 'body'];
const rejectionFields = ['kind', 'code', 'status', 'message', 'body'];
const attachmentFields = ['guard', 'qualifier'];
const standardRejectionsFields = ['invalidInput', 'notFound', 'notImplemented'];
const standardRejectionFields = ['code', 'status', 'message'];

/** Every object an author writes holds only the fields its kind declares, at every level. */
export function undeclaredFieldFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { root, groups, definitions, endpoints, guards, rejections, standardRejections } =
    declarations;
  const written: readonly Written[] = [
    { at: [], value: root, declared: rootFields[root.kind] },
    ...definitions.map(({ at, definitions: listed }) => ({
      at,
      value: listed,
      declared: rootFields.definitions,
    })),
    ...groups.map(({ at, group }) => ({ at, value: group, declared: groupFields })),
    ...endpoints.flatMap(({ at, endpoint }) => [
      { at, value: endpoint, declared: endpointFields },
      { at: [...at, 'input'], value: endpoint.input, declared: inputFields },
      { at: [...at, 'success'], value: endpoint.success, declared: successFields },
      ...attachmentsOf(at, endpoint.guards),
    ]),
    ...guards.flatMap(({ at, guard }) => [
      { at, value: guard, declared: guardFields },
      { at: [...at, 'demands'], value: guard.demands, declared: demandsFields },
    ]),
    ...rejections.map(({ at, rejection }) => ({ at, value: rejection, declared: rejectionFields })),
    ...standardRejectionsOf(declarations),
    ...standardRejections.map(({ at, declaration }) => ({
      at,
      value: declaration,
      declared: standardRejectionFields,
    })),
  ];
  return written.flatMap(undeclaredFieldsOf);
}

function attachmentsOf(at: Path, attachments: unknown): readonly Written[] {
  return listOf(attachments as readonly unknown[] | undefined)
    .map((attachment, index) => ({
      at: [...at, 'guards', index],
      value: attachment,
      declared: attachmentFields,
    }))
    .filter((written) => !isGuard(written.value));
}

/** The `standardRejections` map of the root or of each listed Definitions Package. */
function standardRejectionsOf({ root, definitions }: Declarations): readonly Written[] {
  const packages = root.kind === 'definitions' ? [{ at: [], definitions: root }] : definitions;
  return packages.map(({ at, definitions: listed }) => ({
    at: [...at, 'standardRejections'],
    value: listed.standardRejections,
    declared: standardRejectionsFields,
  }));
}

function undeclaredFieldsOf({ at, value, declared }: Written): readonly DeclarationFailure[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const undeclared = Object.keys(value).filter((field) => !declared.includes(field));
  return undeclared.map((field) =>
    failure([...at, field], 'undeclared-field', `${field} is not a declared field`),
  );
}
