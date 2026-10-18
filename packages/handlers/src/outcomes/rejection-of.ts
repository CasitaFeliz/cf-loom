import { type AnswerableRejection, isSameRejection } from '@casitafeliz/loom-contract/internal';

/**
 * Whether what a direct call returned is a given Rejection, told by its declaration, a Standard
 * one by its name; it narrows to that Rejection, its body typed.
 */
export function isRejectionOf<
  Answer extends { readonly kind: string },
  Answered extends AnswerableRejection,
>(
  answer: Answer,
  rejection: Answered,
): answer is Extract<Answer, { readonly rejection: Answered }> {
  if (answer.kind !== 'rejection' || !('rejection' in answer)) {
    return false;
  }
  return isSameRejection(rejection, answer.rejection);
}
