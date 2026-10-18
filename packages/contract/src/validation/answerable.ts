import {
  addedStandardRejectionNames,
  type Endpoint,
  type Guard,
  invalidInput,
  isEndpoint,
  isRejection,
  isStandardRejection,
  notImplemented,
  type Rejection,
  type StandardRejection,
} from '../declarations/index.ts';
import { attachedGuardsOf } from './references.ts';
import { listOf } from './written.ts';

/** A Rejection as an Endpoint or a Guard may answer it: a declared one or a Standard one. */
export type AnswerableRejection = Rejection | StandardRejection;

const addedByName = { invalidInput, notImplemented };

/** Every Rejection an Endpoint or a Guard may answer, each once (see `RejectionsOf`). */
export function answerableRejectionsOf(element: Endpoint | Guard): readonly AnswerableRejection[] {
  if (!isEndpoint(element)) {
    return distinct([...listOf(element.rejections), notImplemented]);
  }
  const ofGuards = attachedGuardsOf(element).flatMap((guard) => listOf(guard.rejections));
  const added = addedStandardRejectionNames.map((name) => addedByName[name]);
  return distinct([...listOf(element.rejections), ...ofGuards, ...added]);
}

function distinct(rejections: readonly unknown[]): readonly AnswerableRejection[] {
  return [...new Set(rejections.filter(isAnswerable))];
}

function isAnswerable(value: unknown): value is AnswerableRejection {
  return isRejection(value) || isStandardRejection(value);
}
