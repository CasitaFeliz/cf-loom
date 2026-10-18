import type {
  Endpoint,
  Guard,
  StandardRejection,
  StandardRejections,
} from '@casitafeliz/loom-contract';
import {
  type AnswerableRejection,
  answerableRejectionsOf,
  isStandardRejection,
  schemaOf,
  successParts,
} from '@casitafeliz/loom-contract/internal';
import type {
  AnyAdmission,
  AnyOutcome,
  AnyRejection,
  BuiltSuccess,
  ResolvedAdmission,
  ResolvedOutcome,
  ResolvedRejection,
} from '../outcomes/index.ts';
import {
  type Checked,
  checkedAll,
  checkedPart,
  fieldNameOf,
  fieldOf,
  mapValue,
} from './checked.ts';
import { resolutionOf } from './resolution.ts';

/** A Rejection a Handler may build: any it answers but invalid input, which is the runtime's. */
type Buildable = Exclude<AnswerableRejection, StandardRejection<'invalidInput'>>;

/**
 * What an EndpointHandler built, checked against its Endpoint and resolved, as `serve` sends it.
 * A valid Contract has no strict object outside Input (COMPATIBILITY.md, Fields), so parsing what
 * a Handler built only strips unknown keys.
 */
export function checkedOutcome(
  endpoint: Endpoint,
  built: AnyOutcome,
  standards: StandardRejections,
): Checked<ResolvedOutcome<Endpoint>> {
  switch (built.kind) {
    case 'success':
      return checkedSuccess(endpoint, built);
    case 'rejection':
      return checkedRejection(endpoint, built, standards);
    case 'fault':
      return { kind: 'value', value: built };
  }
}

/**
 * What a GuardHandler built, checked against its Guard and resolved, its admitted Context parsed
 * as an Outcome is. The Rejection check knows only that it answers for a Guard, which never
 * answers not found, so its result is narrowed to the Guard's.
 */
export function checkedAdmission(
  guard: Guard,
  built: AnyAdmission,
  standards: StandardRejections,
): Checked<ResolvedAdmission<Guard>> {
  switch (built.kind) {
    case 'admitted': {
      const context = checkedPart('context', schemaOf(guard, 'context'), { value: built.context });
      return mapValue(context, (parsed) => ({ kind: 'admitted', context: parsed }));
    }
    case 'rejection':
      return checkedRejection(guard, built, standards) as Checked<ResolvedAdmission<Guard>>;
    case 'fault':
      return { kind: 'value', value: built };
  }
}

/**
 * The value a Handler gave `success()`, read by its Endpoint: the body, or `{ headers, body }`
 * when the Endpoint declares headers; only the parts it declares come back.
 */
function checkedSuccess(
  endpoint: Endpoint,
  { value }: BuiltSuccess<unknown>,
): Checked<ResolvedOutcome<Endpoint>> {
  const given = schemaOf(endpoint, 'success.headers') === undefined ? { body: value } : value;
  const checks = successParts.map((part) => {
    const field = fieldNameOf(part);
    return [field, checkedPart(part, schemaOf(endpoint, part), { value: fieldOf(given, field) })];
  });
  const declared = successParts.filter((part) => schemaOf(endpoint, part) !== undefined);
  return mapValue(checkedAll(Object.fromEntries(checks)), (parts) => {
    const entries = declared.map((part) => [fieldNameOf(part), parts[fieldNameOf(part)]]);
    return { kind: 'success', status: endpoint.success.status, ...Object.fromEntries(entries) };
  });
}

/** A Rejection a Handler built: one its Endpoint or Guard answers, with the body it declares and no other. */
function checkedRejection(
  answering: Endpoint | Guard,
  built: AnyRejection,
  standards: StandardRejections,
): Checked<ResolvedRejection<Buildable>> {
  const { rejection } = built;
  if (!isBuildableBy(answering, rejection)) {
    const message = `${codeOf(rejection)} is not a Rejection ${answering.name} answers`;
    const issue = { part: 'rejections', path: [], code: 'invalid_value', message } as const;
    return { kind: 'issues', issues: [issue] };
  }
  const value = fieldOf(built, 'body');
  if (isStandardRejection(rejection)) {
    const body = checkedPart('body', undefined, { value });
    return mapValue(body, () => resolvedStandardOf(rejection, standards));
  }
  const resolution = resolutionOf(rejection, standards);
  const body = checkedPart('body', schemaOf(rejection, 'body'), { value });
  return mapValue(body, (parsed) =>
    parsed === undefined
      ? { kind: 'rejection', rejection, ...resolution }
      : { kind: 'rejection', rejection, body: parsed, ...resolution },
  );
}

/** A Standard Rejection a Handler may build, by its name, resolved against the root's. */
function resolvedStandardOf(
  rejection: Extract<Buildable, StandardRejection>,
  standards: StandardRejections,
): ResolvedRejection<Buildable> {
  const resolution = resolutionOf(rejection, standards);
  switch (rejection.name) {
    case 'notFound':
      return { kind: 'rejection', rejection, ...resolution };
    case 'notImplemented':
      return { kind: 'rejection', rejection, ...resolution };
  }
}

function isBuildableBy(answering: Endpoint | Guard, rejection: unknown): rejection is Buildable {
  const isInvalidInput = isStandardRejection(rejection) && rejection.name === 'invalidInput';
  const answerable: readonly unknown[] = answerableRejectionsOf(answering);
  return answerable.includes(rejection) && !isInvalidInput;
}

function codeOf(rejection: unknown): string {
  if (isStandardRejection(rejection)) {
    return rejection.name;
  }
  return String(fieldOf(rejection, 'code') ?? 'A value that is no Rejection');
}
