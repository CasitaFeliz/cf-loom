import { isRejectionStatus } from '../http.ts';
import { isStandardRejection } from '../predicates.ts';
import { addedStandardRejectionNames, standardRejectionNames } from '../standard-rejections.ts';
import type {
  Declarations,
  LocatedEndpoint,
  LocatedGuard,
  LocatedRejection,
  LocatedStandardRejection,
} from './declarations.ts';
import { listOf } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';

/** cf-loom's own codes for the Standard Rejections, where no Definitions Package declares one. */
const defaultStandardCodes: Readonly<Record<string, string>> = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};

/** cf-loom's own statuses for the Standard Rejections, where no Definitions Package declares one. */
const defaultStandardStatuses: Readonly<Record<string, number>> = {
  invalidInput: 400,
  notFound: 404,
  notImplemented: 501,
};

/** A Standard Rejection resolved: its code and status, from a Definitions Package or the defaults. */
export type ResolvedStandard = { readonly code: string; readonly status: unknown };

/** A declared Standard Rejection is 4xx too, except not-implemented, which is always 501. */
export function standardStatusFailures({
  at,
  name,
  declaration,
}: LocatedStandardRejection): readonly DeclarationFailure[] {
  const { status } = declaration;
  if (status === undefined) {
    return [];
  }
  if (name === 'notImplemented') {
    const message = `The not-implemented Rejection's status is 501: ${String(status)}`;
    return status === 501 ? [] : [failure([...at, 'status'], 'rejection-status', message)];
  }
  const message = `A Rejection's status is 4xx: ${String(status)}`;
  return isRejectionStatus(status) ? [] : [failure([...at, 'status'], 'rejection-status', message)];
}

/** The invalid-input and not-implemented Rejections are added to every Endpoint, so none lists them. */
export function listedStandardFailures({
  at,
  endpoint,
}: LocatedEndpoint): readonly DeclarationFailure[] {
  const listed = listOf(endpoint.rejections).map((rejection, index) => ({
    name: standardNameOf(rejection),
    index,
  }));
  const addedNames: readonly unknown[] = addedStandardRejectionNames;
  const added = listed.filter(({ name }) => addedNames.includes(name));
  return added.map(({ name, index }) =>
    failure(
      [...at, 'rejections', index],
      'standard-rejection-listed',
      `${String(name)} is added to every Endpoint without listing it`,
    ),
  );
}

/** A Guard lists declared Rejections only, never a Standard Rejection. */
export function guardStandardFailures({ at, guard }: LocatedGuard): readonly DeclarationFailure[] {
  const listed = listOf(guard.rejections).map((rejection, index) => ({
    name: standardNameOf(rejection),
    index,
  }));
  const standard = listed.filter(({ name }) => name !== undefined);
  return standard.map(({ name, index }) =>
    failure(
      [...at, 'rejections', index],
      'standard-rejection-on-guard',
      `A Guard lists declared Rejections only: ${String(name)}`,
    ),
  );
}

/** Each Standard Rejection as the root resolves it: the Definitions Package's, else cf-loom's. */
export function resolvedStandards(
  standardRejections: readonly LocatedStandardRejection[],
): readonly ResolvedStandard[] {
  return standardRejectionNames.map((name) => {
    const declared = standardRejections.find((located) => located.name === name);
    return {
      code: String(declared?.declaration.code ?? defaultStandardCodes[name]),
      status: declared?.declaration.status ?? defaultStandardStatuses[name],
    };
  });
}

/** No declared Rejection takes the code a Standard Rejection resolves to. */
export function redefinitionFailures(
  rejections: readonly LocatedRejection[],
  resolved: readonly ResolvedStandard[],
): readonly DeclarationFailure[] {
  const standardCodes = resolved.map(({ code }) => code);
  return rejections
    .filter(({ rejection }) => standardCodes.includes(String(rejection.code)))
    .map(({ at, rejection }) =>
      failure(
        [...at, 'code'],
        'standard-code-redefined',
        `No Contract redefines a Standard Rejection: ${String(rejection.code)}`,
      ),
    );
}

/** At most one listed Definitions Package declares Standard Rejections. */
export function onceFailures({ definitions }: Declarations): readonly DeclarationFailure[] {
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
      `At most one listed Definitions Package declares Standard Rejections: ${String(first.definitions.name)} already does`,
    ),
  );
}

/** The name of a Standard Rejection, from any copy of this package; nothing for anything else. */

/** The name of a Standard Rejection, from any copy of this package; nothing for anything else. */
function standardNameOf(value: unknown): unknown {
  return isStandardRejection(value) ? value.name : undefined;
}
