import type {
  Endpoint,
  Guard,
  Rejection,
  StandardRejection,
  StandardRejections,
} from '@cf-loom/contract';
import {
  type AnswerableRejection,
  answerableRejectionsOf,
  isRejection,
  isSameRejection,
  isStandardRejection,
  resolutionOf,
  schemaOf,
} from '@cf-loom/contract/internal';
import type { AnyRejection, ResolvedRejection } from '../outcomes/index.ts';
import { type Checked, checkedPart, fieldOf, mapValue } from './checked.ts';

/** A Rejection an EndpointHandler may build: any its Endpoint answers but invalid input, the runtime's. */
type EndpointRejection = Exclude<AnswerableRejection, StandardRejection<'invalidInput'>>;

/** A Rejection a GuardHandler may build: its Guard's own, or not implemented. */
type GuardRejection = Rejection | StandardRejection<'notImplemented'>;

/** A Rejection an EndpointHandler built, checked against its Endpoint and resolved. */
export function checkedEndpointRejection(
  endpoint: Endpoint,
  built: AnyRejection,
  standards: StandardRejections,
): Checked<ResolvedRejection<EndpointRejection>> {
  const { rejection } = built;
  if (!isEndpointRejection(endpoint, rejection)) {
    return notAnswered(endpoint, rejection);
  }
  return checkedBuilt(rejection, built, standards);
}

/** A Rejection a GuardHandler built, checked against its Guard and resolved. */
export function checkedGuardRejection(
  guard: Guard,
  built: AnyRejection,
  standards: StandardRejections,
): Checked<ResolvedRejection<GuardRejection>> {
  const { rejection } = built;
  if (!isGuardRejection(guard, rejection)) {
    return notAnswered(guard, rejection);
  }
  return checkedBuilt(rejection, built, standards);
}

function isEndpointRejection(
  endpoint: Endpoint,
  rejection: AnswerableRejection,
): rejection is EndpointRejection {
  const isInvalidInput = isStandardRejection(rejection) && rejection.name === 'invalidInput';
  return isAnsweredBy(endpoint, rejection) && !isInvalidInput;
}

function isGuardRejection(
  guard: Guard,
  rejection: AnswerableRejection,
): rejection is GuardRejection {
  return isAnsweredBy(guard, rejection);
}

/** Whether an Endpoint or a Guard answers a Rejection; a Standard one is told by its name, from any copy of @cf-loom/contract. */
function isAnsweredBy(answering: Endpoint | Guard, rejection: AnswerableRejection): boolean {
  return answerableRejectionsOf(answering).some((listed) => isSameRejection(listed, rejection));
}

/** A Rejection its Endpoint or Guard answers, with the body it declares and no other. */
function checkedBuilt<Answered extends EndpointRejection>(
  rejection: Answered,
  built: AnyRejection,
  standards: StandardRejections,
): Checked<ResolvedRejection<Answered>> {
  const schema = isRejection(rejection) ? schemaOf(rejection, 'body') : undefined;
  const body = checkedPart('body', schema, { value: fieldOf(built, 'body') });
  return mapValue(body, (parsed) => resolvedRejectionOf(rejection, parsed, standards));
}

/**
 * A Rejection with its parsed body and its code, status and message resolved. The type
 * distributes over each Rejection it may be, which no single object literal states, so the
 * checked value is cast once here.
 */
function resolvedRejectionOf<Answered extends EndpointRejection>(
  rejection: Answered,
  body: unknown,
  standards: StandardRejections,
): ResolvedRejection<Answered> {
  const resolution = resolutionOf(rejection, standards);
  const resolved =
    body === undefined
      ? { kind: 'rejection' as const, rejection, ...resolution }
      : { kind: 'rejection' as const, rejection, body, ...resolution };
  return resolved as unknown as ResolvedRejection<Answered>;
}

function notAnswered(answering: Endpoint | Guard, rejection: unknown): Checked<never> {
  const message = `${codeOf(rejection)} is not a Rejection ${answering.name} answers`;
  return {
    kind: 'issues',
    issues: [{ part: 'rejections', path: [], code: 'invalid_value', message }],
  };
}

function codeOf(rejection: unknown): string {
  if (isStandardRejection(rejection)) {
    return rejection.name;
  }
  return String(fieldOf(rejection, 'code') ?? 'A value that is no Rejection');
}
