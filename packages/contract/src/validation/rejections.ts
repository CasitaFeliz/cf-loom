import { isRejectionStatus } from '../http.ts';
import type { Path, SchemaNode } from '../walker/nodes.ts';
import type { Declarations, LocatedRejection } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { type Nodes, slotAt } from './schemas.ts';
import { shapeKey } from './shapes.ts';
import {
  distinctCodeFailures,
  guardStandardFailures,
  listedStandardFailures,
  onceFailures,
  type ResolvedStandard,
  redefinitionFailures,
  resolvedStandards,
  standardStatusFailures,
} from './standard-codes.ts';
import { isMissing, textOf } from './written.ts';

/** The declarations of one code, at least one, the first met first. */
type CodeGroup = readonly [LocatedRejection, ...LocatedRejection[]];

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
    ...distinctCodeFailures(resolved),
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
  return conflicting.map(([code, [first]]) =>
    failure(
      slotAt(first.at, 'body'),
      'code-body-conflict',
      `A code has one body schema across the Contract: ${code}`,
    ),
  );
}

function statusFailures({ at, rejection }: LocatedRejection): readonly DeclarationFailure[] {
  if (isMissing(rejection.status) || isRejectionStatus(rejection.status)) {
    return [];
  }
  const message = `A Rejection's status is 4xx: ${textOf(rejection.status)}`;
  return [failure([...at, 'status'], 'rejection-status', message)];
}

function reservedFailures(at: Path, code: unknown): readonly DeclarationFailure[] {
  if (!reservedCodes.includes(code)) {
    return [];
  }
  const message = `A code cf-loom answers as a Fault is reserved: ${textOf(code)}`;
  return [failure([...at, 'code'], 'reserved-code', message)];
}

/** One HTTP status per code, the resolved Standard Rejections' codes among the declarations. */
function statusConflictFailures(
  rejections: readonly LocatedRejection[],
  resolved: readonly ResolvedStandard[],
): readonly DeclarationFailure[] {
  const conflicting = [...groupedByCode(rejections).entries()]
    .map(([code, declared]) => ({
      code,
      declared,
      statuses: distinctStatuses(code, declared, resolved),
    }))
    .filter(({ statuses }) => statuses.length > 1);
  return conflicting.map(({ code, declared: [first], statuses }) =>
    failure(
      [...first.at, 'status'],
      'code-status-conflict',
      `A code has one HTTP status across the Contract: ${code} is ${statuses.join(' and ')}`,
    ),
  );
}

function groupedByCode(rejections: readonly LocatedRejection[]): ReadonlyMap<string, CodeGroup> {
  const byCode = new Map<string, CodeGroup>();
  for (const located of rejections) {
    const code = textOf(located.rejection.code);
    const group = byCode.get(code);
    byCode.set(code, group === undefined ? [located] : [...group, located]);
  }
  return byCode;
}

/** The statuses a code is declared with, the Standard Rejections resolving to it included. */
function distinctStatuses(
  code: string,
  declared: CodeGroup,
  resolved: readonly ResolvedStandard[],
): readonly string[] {
  const standard = resolved
    .filter((entry) => entry.code === code)
    .map((entry) => textOf(entry.status));
  const statuses = declared.map(({ rejection }) => textOf(rejection.status));
  return [...new Set([...standard, ...statuses])];
}

/** Bodies differ when some declarations have one and others none, or two walked to different shapes. */
function bodiesDiffer(declared: CodeGroup, nodes: Nodes): boolean {
  const withBody = declared.filter(({ rejection }) => rejection.body !== undefined);
  const someWithout = withBody.length > 0 && withBody.length < declared.length;
  const bodies = declared.map(({ rejection }) => nodes.nodeOf(rejection, 'body'));
  const shapes = bodies.filter(isNode).map(shapeKey);
  return someWithout || new Set(shapes).size > 1;
}

function isNode(node: SchemaNode | undefined): node is SchemaNode {
  return node !== undefined;
}
