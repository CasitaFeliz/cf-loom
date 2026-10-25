import {
  isRejection,
  isRejectionStatus,
  isReservedCode,
  isStandardRejection,
} from '../declarations/index.ts';
import { type Path, type SchemaNode, shapeKey } from '../walker/index.ts';
import {
  type Declarations,
  isMissing,
  isWithoutValue,
  type LocatedCode,
  type LocatedRejection,
  listOf,
  type ResolvedStandard,
  resolvedStandards,
  slotAt,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { repeated } from './names.ts';
import type { Nodes } from './schemas.ts';
import {
  distinctCodeFailures,
  guardStandardFailures,
  listedStandardFailures,
  onceFailures,
  redefinitionFailures,
  standardStatusFailures,
} from './standard-codes.ts';

/** The rules on Rejections and codes that read declarations alone. */
export function rejectionFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { rejections, codes, standardRejections, endpoints, guards } = declarations;
  const resolved = resolvedStandards(declarations);
  return [
    ...rejections.flatMap(statusFailures),
    ...standardRejections.flatMap(standardStatusFailures),
    ...rejections.flatMap((located) => reservedFailures(located.at, located.rejection.code)),
    ...standardRejections.flatMap((located) =>
      reservedFailures(located.at, located.declaration.code),
    ),
    ...endpoints.flatMap(listedStandardFailures),
    ...guards.flatMap(guardStandardFailures),
    ...endpoints.flatMap(({ at, endpoint }) => listedOnceFailures(at, endpoint.rejections)),
    ...guards.flatMap(({ at, guard }) => listedOnceFailures(at, guard.rejections)),
    ...distinctCodeFailures(resolved),
    ...redefinitionFailures(rejections, resolved),
    ...onceFailures(declarations),
    ...statusConflictFailures(codes, resolved),
  ];
}

/** A code has one body shape across the whole Contract, judged on the walked bodies. */
export function rejectionBodyFailures(
  { codes }: Declarations,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  return codes
    .filter((located) => bodiesDiffer(located, nodes))
    .map(({ code, at }) =>
      failure(
        slotAt(at, 'body'),
        'code-body-conflict',
        `A code has one body schema across the Contract: ${code}`,
      ),
    );
}

function statusFailures({ at, rejection }: LocatedRejection): readonly DeclarationFailure[] {
  if (isWithoutValue(rejection.status) || isRejectionStatus(rejection.status)) {
    return [];
  }
  const message = `A Rejection's status is 4xx: ${textOf(rejection.status)}`;
  return [failure([...at, 'status'], 'rejection-status', message)];
}

/** A list of Rejections names each once: a declared one by its code, a Standard one by its name. */
function listedOnceFailures(at: Path, rejections: unknown): readonly DeclarationFailure[] {
  const listed = listOf(rejections).map((rejection, index) => ({
    index,
    key: listedKeyOf(rejection),
  }));
  const named = listed.filter(
    (entry): entry is { index: number; key: string } => entry.key !== undefined,
  );
  return repeated(named, ({ key }) => key).map(({ index, key }) =>
    failure([...at, 'rejections', index], 'rejection-once', `${key} is listed twice`),
  );
}

function listedKeyOf(rejection: unknown): string | undefined {
  if (isStandardRejection(rejection)) {
    return textOf(rejection.name);
  }
  return isRejection(rejection) && typeof rejection.code === 'string' ? rejection.code : undefined;
}

function reservedFailures(at: Path, code: unknown): readonly DeclarationFailure[] {
  if (!isReservedCode(code)) {
    return [];
  }
  const message = `A code cf-loom answers as a Fault is reserved: ${textOf(code)}`;
  return [failure([...at, 'code'], 'reserved-code', message)];
}

/** One HTTP status per code, the resolved Standard Rejections' codes among the declarations. */
function statusConflictFailures(
  codes: readonly LocatedCode[],
  resolved: readonly ResolvedStandard[],
): readonly DeclarationFailure[] {
  return codes
    .map((located) => ({ located, statuses: distinctStatuses(located, resolved) }))
    .filter(({ statuses }) => statuses.length > 1)
    .map(({ located: { code, at }, statuses }) =>
      failure(
        [...at, 'status'],
        'code-status-conflict',
        `A code has one HTTP status across the Contract: ${code} is ${statuses.join(' and ')}`,
      ),
    );
}

/** The statuses a code is declared with, the Standard Rejections resolving to it included. */
function distinctStatuses(
  { code, rejections }: LocatedCode,
  resolved: readonly ResolvedStandard[],
): readonly string[] {
  const standard = resolved
    .filter((entry) => entry.code === code)
    .map((entry) => textOf(entry.status));
  const statuses = rejections.map(({ rejection }) => textOf(rejection.status));
  return [...new Set([...standard, ...statuses])];
}

/** Bodies differ when some declarations have one and others none, or two walked to different shapes. */
function bodiesDiffer({ rejections }: LocatedCode, nodes: Nodes): boolean {
  const without = rejections.filter(({ rejection }) => isMissing(rejection.body));
  const bodies = rejections.map(({ rejection }) => nodes.nodeOf(rejection, 'body'));
  const shapes = bodies.filter(isNode).map(shapeKey);
  const someWithout = shapes.length > 0 && without.length > 0;
  return someWithout || new Set(shapes).size > 1;
}

function isNode(node: SchemaNode | undefined): node is SchemaNode {
  return node !== undefined;
}
