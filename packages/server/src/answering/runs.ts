import type { ReservedCode, StandardRejections } from '@cf-loom/contract';
import {
  faultResponseOf,
  type InputIssue,
  internalError,
  invalidInputResponseOf,
  isInputPart,
  rejectionResponseOf,
  reservedResponseOf,
  resolutionOf,
  type SentRejection,
  type SentSuccess,
  successResponseOf,
} from '@cf-loom/contract/internal';
import type { Fault, Issue } from '@cf-loom/handlers';
import type { EndpointRun, GuardRun } from '@cf-loom/handlers/internal';
import type { AnsweredRequest, FaultedBy, ServedFault } from './hooks.ts';

/**
 * How one request was answered, with the code sent: a Rejection's as its Root resolves it, or a
 * reserved Fault's; only a Fault may be the Service's, for `onServiceFault`.
 */
export type Answered =
  | { readonly kind: 'success'; readonly response: Response }
  | { readonly kind: 'rejection'; readonly response: Response; readonly code: string }
  | {
      readonly kind: 'fault';
      readonly response: Response;
      readonly code?: ReservedCode;
      readonly servedFault?: ServedFault;
    };

/** A run that did not answer: given what broke the Contract, built what broke it, or threw. */
export type FailedRun = Exclude<EndpointRun, { readonly kind: 'answered' }>;

/** What a run answered: an EndpointHandler's Outcome or a GuardHandler's Admission, as checked. */
type RunAnswer = Extract<EndpointRun | GuardRun, { readonly kind: 'answered' }>['answer'];

/** What a Handler answered that is not a Success: a Rejection as built, or a Fault it returned. */
type NotSuccess = Extract<RunAnswer, { readonly kind: 'rejection' }> | Fault;

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
      const servedFault = { ...faultedBy, kind: 'thrown' as const, cause: run.fault.cause };
      return { kind: 'fault', response: faultResponseOf(run.fault), servedFault };
    }
  }
}

/** A Success a Handler answered, as its run checked it. */
export function answeredOfSuccess(success: SentSuccess): Answered {
  return { kind: 'success', response: successResponseOf(success) };
}

/**
 * A Rejection or a Fault a Handler answered, as sent: a Rejection with the code, status and message
 * its Root resolves; a returned Fault is the Service's too.
 */
export function answeredOfNotSuccess(
  answer: NotSuccess,
  faultedBy: FaultedBy,
  standards: StandardRejections,
): Answered {
  switch (answer.kind) {
    case 'rejection': {
      const sent = sentRejectionOf(answer, standards);
      return { kind: 'rejection', response: rejectionResponseOf(sent), code: sent.code };
    }
    case 'fault': {
      const servedFault = { ...faultedBy, kind: 'returned' as const, fault: answer };
      return { kind: 'fault', response: faultResponseOf(answer), servedFault };
    }
  }
}

/** A Rejection as built, as it travels: its code, status and message as the Root resolves them, its headers and its body. */
function sentRejectionOf(
  { rejection, ...built }: Extract<NotSuccess, { readonly kind: 'rejection' }>,
  standards: StandardRejections,
): SentRejection {
  const headers = 'headers' in built ? built.headers : undefined;
  const body = 'body' in built ? built.body : undefined;
  return { ...resolutionOf(rejection, standards), headers, body };
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
  return { kind: 'rejection', response, code: standards.invalidInput.code };
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
  return { ...reservedAnsweredOf('INVALID_OUTCOME'), servedFault };
}

/** A reserved Fault answered: its response, by default the one its code alone gives, and its code. */
export function reservedAnsweredOf(
  code: ReservedCode,
  response: Response = reservedResponseOf(code),
): Extract<Answered, { readonly kind: 'fault' }> {
  return { kind: 'fault', response, code };
}

/** What a request's record says of its answer: its status and kind, and its code when it has one. */
export function sentOf(answered: Answered): Pick<AnsweredRequest, 'status' | 'kind' | 'code'> {
  const { kind, response } = answered;
  if (kind === 'success' || answered.code === undefined) {
    return { status: response.status, kind };
  }
  return { status: response.status, kind, code: answered.code };
}

function isInputIssue(issue: Issue): issue is InputIssue {
  return isInputPart(issue.part);
}
