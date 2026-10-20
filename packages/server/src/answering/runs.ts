import type { StandardRejections } from '@casitafeliz/loom-contract';
import {
  faultResponseOf,
  headerTextsOf,
  type InputIssue,
  internalError,
  invalidInputResponseOf,
  isInputPart,
  rejectionResponseOf,
  reservedResponseOf,
  type SentRejection,
  successResponseOf,
} from '@casitafeliz/loom-contract/internal';
import type { Fault, Issue } from '@casitafeliz/loom-handlers';
import type { EndpointRun } from '@casitafeliz/loom-handlers/internal';
import type { AnsweredRequest, FaultedBy, ServedFault } from './hooks.ts';

/** How one request was answered; only a Fault may be the Service's, for `onServiceFault`. */
export type Answered =
  | { readonly kind: Exclude<AnsweredRequest['kind'], 'fault'>; readonly response: Response }
  | { readonly kind: 'fault'; readonly response: Response; readonly servedFault?: ServedFault };

/** A run that did not answer: given what broke the Contract, built what broke it, or threw. */
export type FailedRun = Exclude<EndpointRun, { readonly kind: 'answered' }>;

/** A Success as the run resolved it: its declared status, and its headers and body when declared. */
type ResolvedSuccess = {
  readonly status: number;
  readonly headers?: Readonly<Record<string, unknown>> | undefined;
  readonly body?: unknown;
};

/** What a Handler answered that is not a Success: a resolved Rejection, or a Fault it returned. */
type NotSuccess = (SentRejection & { readonly kind: 'rejection' }) | Fault;

/** A run that did not answer, answered: the Caller's invalid input told from the runtime's bug. */
export function answeredOfFailedRun(
  run: FailedRun,
  faultedBy: FaultedBy,
  standards: StandardRejections,
): Answered {
  switch (run.kind) {
    case 'invalid-input':
      return answeredOfInvalidInput(run.issues, faultedBy, standards);
    case 'invalid-outcome':
      return invalidOutcomeOf(run.issues, faultedBy);
    case 'thrown': {
      const servedFault = { ...faultedBy, kind: 'thrown' as const, fault: run.fault };
      return { kind: 'fault', response: handlerFaultResponseOf(run.fault), servedFault };
    }
  }
}

/** A Success a Handler answered, sent only when each of its headers can travel as text. */
export function answeredOfSuccess(success: ResolvedSuccess, faultedBy: FaultedBy): Answered {
  const headers = headerTextsOf('success.headers', success.headers);
  if (headers.kind === 'issues') {
    return invalidOutcomeOf(headers.issues, faultedBy);
  }
  const sent = { status: success.status, headers: headers.texts, body: success.body };
  return { kind: 'success', response: successResponseOf(sent) };
}

/** A Rejection or a Fault a Handler answered, as sent; a returned Fault is the Service's too. */
export function answeredOfNotSuccess(answer: NotSuccess, faultedBy: FaultedBy): Answered {
  switch (answer.kind) {
    case 'rejection':
      return { kind: 'rejection', response: rejectionResponseOf(answer) };
    case 'fault': {
      const servedFault = { ...faultedBy, kind: 'returned' as const, fault: answer };
      return { kind: 'fault', response: handlerFaultResponseOf(answer), servedFault };
    }
  }
}

/**
 * The invalid-input Rejection, the one place it is built, for Issues the Caller caused, whether
 * the run or the reading of the request found them; one `serve` caused is its own bug.
 */
export function answeredOfInvalidInput(
  issues: readonly Issue[],
  faultedBy: FaultedBy,
  standards: StandardRejections,
): Answered {
  const runtimeIssues = issues.filter((issue) => !isInputPart(issue.part));
  if (runtimeIssues.length > 0) {
    const servedFault = { ...faultedBy, kind: 'runtime-bug' as const, issues: runtimeIssues };
    return { kind: 'fault', response: runtimeBugResponse(), servedFault };
  }
  const response = invalidInputResponseOf(issues.filter(isInputIssue), standards);
  return { kind: 'rejection', response };
}

/**
 * The response of a Fault a Handler built or the run made of a throw: only what a Handler's
 * Fault says travels, so no field it adds can make it a reserved Fault.
 */
function handlerFaultResponseOf({ committed, retryable, message }: Fault): Response {
  return faultResponseOf({ committed, retryable, message });
}

/**
 * The response of the runtime's own bug, a Context or Qualifier `serve` built that broke the
 * Contract: not committed, since the run refused it before the implementation ran.
 */
function runtimeBugResponse(): Response {
  return faultResponseOf({ committed: 'no', retryable: false, message: internalError });
}

function invalidOutcomeOf(issues: readonly Issue[], faultedBy: FaultedBy): Answered {
  const servedFault = { ...faultedBy, kind: 'invalid-outcome' as const, issues };
  return { kind: 'fault', response: reservedResponseOf('INVALID_OUTCOME'), servedFault };
}

function isInputIssue(issue: Issue): issue is InputIssue {
  return isInputPart(issue.part);
}
