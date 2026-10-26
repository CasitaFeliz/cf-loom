import {
  addedStandardRejectionNames,
  isRejectionStatus,
  isStandardRejection,
  notImplementedStatus,
} from '../declarations/index.ts';
import { fieldStep, indexStep, inFields, inside } from '../walker/index.ts';
import {
  isWithoutValue,
  type LocatedEndpoint,
  type LocatedGuard,
  type LocatedStandardRejection,
  listOf,
  textOf,
  writtenTextOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure } from './failures.ts';

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
    const message = `The not-implemented Rejection's status is ${notImplementedStatus}: ${writtenTextOf(status)}`;
    return status === notImplementedStatus
      ? []
      : [failure(inFields(at, 'status'), 'rejection-status', message)];
  }
  const message = `A Rejection's status is 4xx: ${writtenTextOf(status)}`;
  return isRejectionStatus(status)
    ? []
    : [failure(inFields(at, 'status'), 'rejection-status', message)];
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
      inside(at, fieldStep('rejections'), indexStep(index)),
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
      inside(at, fieldStep('rejections'), indexStep(index)),
      'standard-rejection-on-guard',
      `A Guard lists declared Rejections only: ${textOf(name)}`,
    ),
  );
}

/** The name of a Standard Rejection, from any copy of this package; nothing for anything else. */
function standardNameOf(value: unknown): unknown {
  return isStandardRejection(value) ? value.name : undefined;
}
