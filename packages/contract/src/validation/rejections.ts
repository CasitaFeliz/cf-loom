import { canonicalJson } from '../walker/canonical-json.ts';
import type { Path } from '../walker/nodes.ts';
import type {
  Declarations,
  LocatedEndpoint,
  LocatedGuard,
  LocatedRejection,
  LocatedStandardRejection,
} from './declarations.ts';
import { listOf } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { Nodes } from './schemas.ts';

/** The codes cf-loom answers outside the Contract, as Faults; no declaration may take one. */
const reservedCodes: readonly unknown[] = [
  'RETIRED',
  'NO_SUCH_ENDPOINT',
  'BODY_TOO_LARGE',
  'INVALID_OUTCOME',
];

/** cf-loom's own codes for the Standard Rejections, where no Definitions Package declares one. */
const defaultStandardCodes: Readonly<Record<string, string>> = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};

/** The Standard Rejections cf-loom's runtime adds to every Endpoint, so none lists them. */
const addedToEveryEndpoint: readonly unknown[] = ['invalidInput', 'notImplemented'];

/** The rules on Rejections and codes that read declarations alone. */
export function rejectionFailures(declarations: Declarations): readonly DeclarationFailure[] {
  const { rejections, standardRejections, endpoints, guards } = declarations;
  return [
    ...rejections.flatMap(statusFailures),
    ...standardRejections.flatMap(standardStatusFailures),
    ...rejections.flatMap((located) => reservedFailures(located.at, located.rejection.code)),
    ...standardRejections.flatMap((located) =>
      reservedFailures(located.at, located.declaration.code),
    ),
    ...endpoints.flatMap(listedStandardFailures),
    ...guards.flatMap(guardStandardFailures),
    ...redefinitionFailures(declarations),
    ...onceFailures(declarations),
    ...statusConflictFailures(rejections),
  ];
}

/** A code has one body schema across the whole Contract, judged on the walked bodies. */
export function rejectionBodyFailures(
  { rejections }: Declarations,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  const byCode = groupedByCode(rejections);
  const conflicting = [...byCode.entries()].filter(([code, declared]) =>
    bodiesDiffer(declared, nodes.nodesAt(['rejections', code, 'body'])),
  );
  return conflicting.map(([code]) =>
    failure(
      ['rejections', code, 'body'],
      'code-conflict',
      `A code has one body schema across the Contract: ${code}`,
    ),
  );
}

function statusFailures({ at, rejection }: LocatedRejection): readonly DeclarationFailure[] {
  if (isRejectionStatus(rejection.status)) {
    return [];
  }
  const message = `A Rejection's status is 4xx: ${String(rejection.status)}`;
  return [failure([...at, 'status'], 'rejection-status', message)];
}

/** A declared Standard Rejection is 4xx too, except not-implemented, which is always 501. */
function standardStatusFailures({
  at,
  name,
  declaration,
}: LocatedStandardRejection): readonly DeclarationFailure[] {
  const { status } = declaration;
  if (name === 'notImplemented') {
    const message = `The not-implemented Rejection's status is 501: ${String(status)}`;
    return status === 501 ? [] : [failure([...at, 'status'], 'rejection-status', message)];
  }
  const message = `A Rejection's status is 4xx: ${String(status)}`;
  return isRejectionStatus(status) ? [] : [failure([...at, 'status'], 'rejection-status', message)];
}

function reservedFailures(at: Path, code: unknown): readonly DeclarationFailure[] {
  if (!reservedCodes.includes(code)) {
    return [];
  }
  const message = `A code cf-loom answers as a Fault is reserved: ${String(code)}`;
  return [failure([...at, 'code'], 'reserved-code', message)];
}

function listedStandardFailures({ at, endpoint }: LocatedEndpoint): readonly DeclarationFailure[] {
  const listed = listOf(endpoint.rejections).map((rejection, index) => ({
    name: standardNameOf(rejection),
    index,
  }));
  const added = listed.filter(({ name }) => addedToEveryEndpoint.includes(name));
  return added.map(({ name, index }) =>
    failure(
      [...at, 'rejections', index],
      'standard-rejection',
      `${String(name)} is added to every Endpoint without listing it`,
    ),
  );
}

function guardStandardFailures({ at, guard }: LocatedGuard): readonly DeclarationFailure[] {
  const listed = listOf(guard.rejections).map((rejection, index) => ({
    name: standardNameOf(rejection),
    index,
  }));
  const standard = listed.filter(({ name }) => name !== undefined);
  return standard.map(({ name, index }) =>
    failure(
      [...at, 'rejections', index],
      'standard-rejection',
      `A Guard lists declared Rejections only: ${String(name)}`,
    ),
  );
}

/** No declared Rejection takes the code a Standard Rejection resolves to. */
function redefinitionFailures({
  rejections,
  standardRejections,
}: Declarations): readonly DeclarationFailure[] {
  const declared = standardRejections.filter(({ name }) =>
    Object.hasOwn(defaultStandardCodes, name),
  );
  const resolved = { ...defaultStandardCodes };
  for (const { name, declaration } of declared) {
    resolved[name] = String(declaration.code);
  }
  const standardCodes = Object.values(resolved);
  return rejections
    .filter(({ rejection }) => standardCodes.includes(rejection.code))
    .map(({ at, rejection }) =>
      failure(
        [...at, 'code'],
        'standard-rejection',
        `No Contract redefines a Standard Rejection: ${rejection.code}`,
      ),
    );
}

function onceFailures({ definitions }: Declarations): readonly DeclarationFailure[] {
  const declaring = definitions.filter(({ definitions: listed }) =>
    Object.values(listed.standardRejections ?? {}).some((declaration) => declaration !== undefined),
  );
  const [first, ...others] = declaring;
  if (first === undefined) {
    return [];
  }
  return others.map(({ at }) =>
    failure(
      [...at, 'standardRejections'],
      'standard-rejections-once',
      `At most one listed Definitions Package declares Standard Rejections: ${first.definitions.name} already does`,
    ),
  );
}

function statusConflictFailures(
  rejections: readonly LocatedRejection[],
): readonly DeclarationFailure[] {
  const conflicting = [...groupedByCode(rejections).entries()]
    .map(([code, declared]) => ({ code, statuses: distinctStatuses(declared) }))
    .filter(({ statuses }) => statuses.length > 1);
  return conflicting.map(({ code, statuses }) =>
    failure(
      ['rejections', code, 'status'],
      'code-conflict',
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

function distinctStatuses(declared: readonly LocatedRejection[]): readonly string[] {
  return [...new Set(declared.map(({ rejection }) => String(rejection.status)))];
}

/** Bodies differ when some declarations have one and others none, or two walked to different nodes. */
function bodiesDiffer(declared: readonly LocatedRejection[], bodies: readonly unknown[]): boolean {
  const withBody = declared.filter(({ rejection }) => rejection.body !== undefined);
  const someWithout = withBody.length > 0 && withBody.length < declared.length;
  return someWithout || new Set(bodies.map(canonicalJson)).size > 1;
}

function isRejectionStatus(status: unknown): boolean {
  return Number.isInteger(status) && typeof status === 'number' && status >= 400 && status <= 499;
}

/** The name of a Standard Rejection, from any copy of this package; nothing for anything else. */
function standardNameOf(value: unknown): unknown {
  const isStandard =
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'standard-rejection';
  return isStandard && 'name' in value ? value.name : undefined;
}
