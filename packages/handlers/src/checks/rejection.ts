import type { Endpoint, Guard, Rejection, StandardRejection } from '@cf-loom/contract';
import {
  type AnswerableRejection,
  answerableRejectionsOf,
  isSameRejection,
  isStandardRejection,
  ownOf,
  parsedShapeOf,
  rejectionShapeOf,
  textOf,
} from '@cf-loom/contract/internal';
import type { AnyRejection, BuiltRejection } from '../outcomes/index.ts';
import { type Checked, mapValue } from './checked.ts';

/** A Rejection an EndpointHandler may build: any its Endpoint answers but invalid input, the runtime's. */
type EndpointRejection = Exclude<AnswerableRejection, StandardRejection<'invalidInput'>>;

/** A Rejection a GuardHandler may build: its Guard's own, or not implemented. */
type GuardRejection = Rejection | StandardRejection<'notImplemented'>;

/** A Rejection an EndpointHandler built, checked against its Endpoint, its body parsed. */
export function checkedEndpointRejection(
  endpoint: Endpoint,
  built: AnyRejection,
): Checked<BuiltRejection<EndpointRejection>> {
  const { rejection } = built;
  if (!isEndpointRejection(endpoint, rejection)) {
    return notAnswered(endpoint, rejection);
  }
  return checkedBuilt(rejection, built);
}

/** A Rejection a GuardHandler built, checked against its Guard, its body parsed. */
export function checkedGuardRejection(
  guard: Guard,
  built: AnyRejection,
): Checked<BuiltRejection<GuardRejection>> {
  const { rejection } = built;
  if (!isGuardRejection(guard, rejection)) {
    return notAnswered(guard, rejection);
  }
  return checkedBuilt(rejection, built);
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

/**
 * A Rejection its Endpoint or Guard answers, with the headers and body it declares and no other,
 * each header checked to travel as text. The type distributes over each Rejection it may be, which
 * no single object literal states, so the checked value is cast once here.
 */
function checkedBuilt<Answered extends EndpointRejection>(
  rejection: Answered,
  built: AnyRejection,
): Checked<BuiltRejection<Answered>> {
  const parsed = parsedShapeOf(rejectionShapeOf(rejection), {
    headers: built.headers,
    body: built.body,
  });
  return mapValue(parsed, (parts) => {
    const checked = { kind: 'rejection', rejection, ...parts };
    return checked as unknown as BuiltRejection<Answered>;
  });
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
  return textOf(ownOf(rejection, 'code') ?? 'A value that is no Rejection');
}
