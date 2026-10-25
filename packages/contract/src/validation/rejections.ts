import {
  isRejection,
  isRejectionStatus,
  isReservedCode,
  isStandardRejection,
} from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import {
  type Declarations,
  isWithoutValue,
  type LocatedRejection,
  listOf,
  textOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { repeated } from './names.ts';
import {
  guardStandardFailures,
  listedStandardFailures,
  standardStatusFailures,
} from './standard-codes.ts';

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
    ...endpoints.flatMap(({ at, endpoint }) => listedOnceFailures(at, endpoint.rejections)),
    ...guards.flatMap(({ at, guard }) => listedOnceFailures(at, guard.rejections)),
  ];
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
