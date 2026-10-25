import {
  addedStandardRejectionNames,
  type Endpoint,
  type Guard,
  invalidInput,
  isEndpoint,
  isRejection,
  isStandardRejection,
  notFound,
  notImplemented,
  type Rejection,
  type StandardRejection,
  type StandardRejections,
  standardRejectionNames,
} from '../declarations/index.ts';
import { attachedGuardsOf } from './references.ts';
import { listOf } from './written.ts';

/** A Rejection as an Endpoint or a Guard may answer it: a declared one or a Standard one. */
export type AnswerableRejection = Rejection | StandardRejection;

const addedByName = { invalidInput, notImplemented };

const standardByName = { ...addedByName, notFound };

/** Every Rejection an Endpoint or a Guard may answer, each once (see `RejectionsOf`). */
export function answerableRejectionsOf(element: Endpoint | Guard): readonly AnswerableRejection[] {
  if (!isEndpoint(element)) {
    return distinct([...listOf(element.rejections), notImplemented]);
  }
  const ofGuards = attachedGuardsOf(element).flatMap((guard) => listOf(guard.rejections));
  const added = addedStandardRejectionNames.map((name) => addedByName[name]);
  return distinct([...listOf(element.rejections), ...ofGuards, ...added]);
}

/** Whether two Rejections are one: a Standard Rejection by its name, from any copy of this package. */
export function isSameRejection(listed: AnswerableRejection, rejection: unknown): boolean {
  if (isStandardRejection(listed) && isStandardRejection(rejection)) {
    return listed.name === rejection.name;
  }
  return listed === rejection;
}

/** A Rejection's code, status and message: its own, or, for a Standard one, the root's resolved. */
export function resolutionOf(
  rejection: AnswerableRejection,
  standards: StandardRejections,
): { readonly code: string; readonly status: number; readonly message: string } {
  if (isStandardRejection(rejection)) {
    return standards[rejection.name];
  }
  const { code, status, message } = rejection;
  return { code, status, message };
}

/** Every Rejection an Endpoint answers, by the code it resolves to, so a received code finds it. */
export function answerableByCodeOf(
  endpoint: Endpoint,
  standards: StandardRejections,
): ReadonlyMap<string, AnswerableRejection> {
  const answerable = answerableRejectionsOf(endpoint);
  return new Map(
    answerable.map((rejection) => [resolutionOf(rejection, standards).code, rejection]),
  );
}

/**
 * Every code a Contract Package declares, by the code it resolves to: each Standard Rejection, and
 * every Rejection its Endpoints answer, their Guards' included.
 */
export function declaredByCodeOf(
  endpoints: readonly Endpoint[],
  standards: StandardRejections,
): ReadonlyMap<string, AnswerableRejection> {
  const standardRejections = standardRejectionNames.map((name) => standardByName[name]);
  const declared = [...standardRejections, ...endpoints.flatMap(answerableRejectionsOf)];
  return new Map(declared.map((rejection) => [resolutionOf(rejection, standards).code, rejection]));
}

function distinct(rejections: readonly unknown[]): readonly AnswerableRejection[] {
  return [...new Set(rejections.filter(isAnswerable))];
}

function isAnswerable(value: unknown): value is AnswerableRejection {
  return isRejection(value) || isStandardRejection(value);
}
