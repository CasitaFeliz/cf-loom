import { isRejectionStatus } from '../http.ts';
import type { Path, SchemaNode } from '../walker/nodes.ts';
import type { Declarations, LocatedRejection } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { Nodes } from './schemas.ts';
import { shapeKey } from './shapes.ts';
import {
  guardStandardFailures,
  listedStandardFailures,
  onceFailures,
  type ResolvedStandard,
  redefinitionFailures,
  resolvedStandards,
  standardStatusFailures,
} from './standard-codes.ts';

/** The codes cf-loom answers outside the Contract, as Faults; no declaration may take one. */
const reservedCodes: readonly unknown[] = [
  'RETIRED',
  'NO_SUCH_ENDPOINT',
  'BODY_TOO_LARGE',
  'INVALID_OUTCOME',
];

/** The rules on Rejections and codes that read declarations alone. */
export function rejectionFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { rejections, standardRejections, endpoints, guards } = declarations;
  const resolved = resolvedStandards(standardRejections);
  return [
    ...rejections.flatMap(statusFailures),
    ...standardRejections.flatMap(standardStatusFailures),
    ...rejections.flatMap((located) => reservedFailures(located.at, located.rejection.code)),
    ...standardRejections.flatMap((located) =>
      reservedFailures(located.at, located.declaration.code),
    ),
    ...endpoints.flatMap(listedStandardFailures),
    ...guards.flatMap(guardStandardFailures),
    ...redefinitionFailures(rejections, resolved),
    ...onceFailures(declarations),
    ...statusConflictFailures(rejections, resolved),
  ];
}

/** A code has one body shape across the whole Contract, judged on the walked bodies. */
export function rejectionBodyFailures(
  { rejections }: Declarations,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  const conflicting = [...groupedByCode(rejections).entries()].filter(([, declared]) =>
    bodiesDiffer(declared, nodes),
  );
  return conflicting.map(([code]) =>
    failure(
      ['rejections', code, 'body'],
      'code-body-conflict',
      `A code has one body schema across the Contract: ${code}`,
    ),
  );
}

function statusFailures({ at, rejection }: LocatedRejection): readonly DeclarationFailure[] {
  if (rejection.status === undefined || isRejectionStatus(rejection.status)) {
    return [];
  }
  const message = `A Rejection's status is 4xx: ${String(rejection.status)}`;
  return [failure([...at, 'status'], 'rejection-status', message)];
}

function reservedFailures(at: Path, code: unknown): readonly DeclarationFailure[] {
  if (!reservedCodes.includes(code)) {
    return [];
  }
  const message = `A code cf-loom answers as a Fault is reserved: ${String(code)}`;
  return [failure([...at, 'code'], 'reserved-code', message)];
}

/** One HTTP status per code, the resolved Standard Rejections' codes among the declarations. */
function statusConflictFailures(
  rejections: readonly LocatedRejection[],
  resolved: readonly ResolvedStandard[],
): readonly DeclarationFailure[] {
  const standardStatuses = new Map(resolved.map(({ code, status }) => [code, String(status)]));
  const conflicting = [...groupedByCode(rejections).entries()]
    .map(([code, declared]) => ({
      code,
      statuses: distinctStatuses(code, declared, standardStatuses),
    }))
    .filter(({ statuses }) => statuses.length > 1);
  return conflicting.map(({ code, statuses }) =>
    failure(
      ['rejections', code, 'status'],
      'code-status-conflict',
      `A code has one HTTP status across the Contract: ${code} is ${statuses.join(' and ')}`,
    ),
  );
}

function groupedByCode(
  rejections: readonly LocatedRejection[],
): ReadonlyMap<string, readonly LocatedRejection[]> {
  const byCode = new Map<string, LocatedRejection[]>();
  for (const located of rejections) {
    const code = String(located.rejection.code);
    byCode.set(code, [...(byCode.get(code) ?? []), located]);
  }
  return byCode;
}

function distinctStatuses(
  code: string,
  declared: readonly LocatedRejection[],
  standardStatuses: ReadonlyMap<string, string>,
): readonly string[] {
  const standard = standardStatuses.get(code);
  const statuses = declared.map(({ rejection }) => String(rejection.status));
  return [...new Set(standard === undefined ? statuses : [standard, ...statuses])];
}

/** Bodies differ when some declarations have one and others none, or two walked to different shapes. */
function bodiesDiffer(declared: readonly LocatedRejection[], nodes: Nodes): boolean {
  const withBody = declared.filter(({ rejection }) => rejection.body !== undefined);
  const someWithout = withBody.length > 0 && withBody.length < declared.length;
  const bodies = declared.map(({ rejection }) => nodes.nodeOf(rejection, 'body'));
  const shapes = bodies.filter(isNode).map(shapeKey);
  return someWithout || new Set(shapes).size > 1;
}

function isNode(node: SchemaNode | undefined): node is SchemaNode {
  return node !== undefined;
}
