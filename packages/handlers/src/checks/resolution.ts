import type { StandardRejections } from '@casitafeliz/loom-contract';
import type { AnswerableRejection } from '@casitafeliz/loom-contract/internal';
import { isStandardRejection } from '@casitafeliz/loom-contract/internal';

/** What a Caller reads of a Rejection besides its body. */
export type Resolution = {
  readonly code: string;
  readonly status: number;
  readonly message: string;
};

/** A declared Rejection resolves to its own code, status and message; a Standard one to the root's. */
export function resolutionOf(
  rejection: AnswerableRejection,
  standards: StandardRejections,
): Resolution {
  if (isStandardRejection(rejection)) {
    return standards[rejection.name];
  }
  const { code, status, message } = rejection;
  return { code, status, message };
}
