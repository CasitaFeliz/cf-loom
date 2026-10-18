import {
  addedStandardRejectionNames,
  isRejectionStatus,
  isStandardRejection,
  type StandardRejectionName,
  standardRejectionDefaults,
  standardRejectionNames,
} from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import type { Declarations } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type {
  LocatedEndpoint,
  LocatedGuard,
  LocatedRejection,
  LocatedStandardRejection,
} from './located.ts';
import { isWithoutValue, listOf, textOf } from './written.ts';

/**
 * A Standard Rejection as the root resolves it: the Definitions Package's declaration, else
 * cf-loom's, with the declaration it came from when it did.
 */
export type ResolvedStandard = {
  readonly name: StandardRejectionName;
  readonly at: Path;
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly declared: LocatedStandardRejection | undefined;
};

const redefinedStandard =
  'Neither a Contract nor a Definitions Package declares a Rejection with the code a Standard Rejection resolves to';

/** A declared Standard Rejection is 4xx too, except not-implemented, which is always 501. */
export function standardStatusFailures({
  at,
  name,
  declaration,
}: LocatedStandardRejection): readonly DeclarationFailure[] {
  const { status } = declaration;
  if (isWithoutValue(status)) {
    return [];
  }
  if (name === 'notImplemented') {
    const message = `The not-implemented Rejection's status is 501: ${textOf(status)}`;
    return status === 501 ? [] : [failure([...at, 'status'], 'rejection-status', message)];
  }
  const message = `A Rejection's status is 4xx: ${textOf(status)}`;
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
      `${textOf(name)} is added to every Endpoint without listing it`,
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
      `A Guard lists declared Rejections only: ${textOf(name)}`,
    ),
  );
}

/**
 * Each Standard Rejection as the root resolves it, in the order cf-loom names them; one cf-loom
 * resolves sits where the declaring Definitions Package would have declared it.
 */
export function resolvedStandards({
  allPackages,
  standardRejections,
}: Pick<Declarations, 'allPackages' | 'standardRejections'>): readonly ResolvedStandard[] {
  const declaring = allPackages.find(({ definitions }) =>
    Object.values(definitions.standardRejections ?? {}).some(
      (declaration) => declaration !== undefined,
    ),
  );
  return standardRejectionNames.map((name) => {
    const declared = standardRejections.find((located) => located.name === name);
    const defaults = standardRejectionDefaults[name];
    return {
      name,
      at: declared?.at ?? [...(declaring?.at ?? []), 'standardRejections', name],
      code: textOf(declared?.declaration.code ?? defaults.code),
      status: declared?.declaration.status ?? defaults.status,
      message: textOf(declared?.declaration.message ?? defaults.message),
      declared,
    };
  });
}

/** Each Standard Rejection resolves to a code of its own; the ones after the first sharing a code fail. */
export function distinctCodeFailures(
  resolved: readonly ResolvedStandard[],
): readonly DeclarationFailure[] {
  return resolved
    .filter(
      (standard, index) => resolved.findIndex((other) => other.code === standard.code) < index,
    )
    .map((standard) => {
      const names = resolved
        .filter((other) => other.code === standard.code)
        .map((other) => other.name)
        .join(' and ');
      const message = `Each Standard Rejection resolves to a code of its own: ${standard.code} is ${names}`;
      return failure([...standard.at, 'code'], 'standard-codes-distinct', message);
    });
}

/** No declared Rejection takes the code a Standard Rejection resolves to. */
export function redefinitionFailures(
  rejections: readonly LocatedRejection[],
  resolved: readonly ResolvedStandard[],
): readonly DeclarationFailure[] {
  const standardCodes = resolved.map(({ code }) => code);
  return rejections
    .filter(({ rejection }) => standardCodes.includes(textOf(rejection.code)))
    .map(({ at, rejection }) =>
      failure(
        [...at, 'code'],
        'standard-code-redefined',
        `${redefinedStandard}: ${textOf(rejection.code)}`,
      ),
    );
}

/** At most one listed Definitions Package declares Standard Rejections; one listed twice is one. */
export function onceFailures({ listedDefinitions }: Declarations): readonly DeclarationFailure[] {
  const once = [
    ...new Map(listedDefinitions.map((located) => [located.definitions, located])).values(),
  ];
  const declaring = once.filter(({ definitions: listed }) =>
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
      `At most one listed Definitions Package declares Standard Rejections: ${textOf(first.definitions.name)} already does`,
    ),
  );
}

/** The name of a Standard Rejection, from any copy of this package; nothing for anything else. */
function standardNameOf(value: unknown): unknown {
  return isStandardRejection(value) ? value.name : undefined;
}
