import type { StandardRejections } from '@casitafeliz/loom-contract';
import { type InputIssue, isInputPart } from '@casitafeliz/loom-contract/internal';
import type { Fault, Issue } from '@casitafeliz/loom-handlers';
import type { EndpointRun } from '@casitafeliz/loom-handlers/internal';
import {
  faultResponseOf,
  invalidInputResponseOf,
  type ResolvedRejection,
  type ResolvedSuccess,
  rejectionResponseOf,
  reservedResponseOf,
  runtimeBugResponse,
  successResponseOf,
} from '../response/index.ts';
import type { AnsweredRequest, ServiceFault } from './hooks.ts';

/** How one request was answered: its kind and response, and the Service's Fault when there is one. */
export type Answered = {
  readonly kind: AnsweredRequest['kind'];
  readonly response: Response;
  readonly serviceFault?: ServiceFault;
};

/** Which Handler ran: the Endpoint's, or the Guard's it names. */
export type Party = { readonly endpoint: string; readonly guard?: string };

/** A run that did not answer: given what broke the Contract, built what broke it, or threw. */
export type FailedRun = Exclude<EndpointRun, { readonly kind: 'answered' }>;

/** What a Handler answered that is not a Success: a resolved Rejection, or a Fault it returned. */
type NotSuccess = (ResolvedRejection & { readonly kind: 'rejection' }) | Fault;

/** A run that did not answer, answered: the Caller's invalid input told from the runtime's bug. */
export function answeredOfFailedRun(
  run: FailedRun,
  party: Party,
  standards: StandardRejections,
): Answered {
  switch (run.kind) {
    case 'invalid-input':
      return answeredOfInvalidInput(run.issues, party, standards);
    case 'invalid-outcome': {
      const serviceFault = { ...party, kind: 'invalid-outcome' as const, issues: run.issues };
      return { kind: 'fault', response: reservedResponseOf('INVALID_OUTCOME'), serviceFault };
    }
    case 'thrown': {
      const serviceFault = { ...party, kind: 'thrown' as const, fault: run.fault };
      return { kind: 'fault', response: faultResponseOf(run.fault), serviceFault };
    }
  }
}

/** A Success a Handler answered, as sent. */
export function answeredOfSuccess(success: ResolvedSuccess): Answered {
  return { kind: 'success', response: successResponseOf(success) };
}

/** A Rejection or a Fault a Handler answered, as sent; a returned Fault is the Service's too. */
export function answeredOfNotSuccess(answer: NotSuccess, party: Party): Answered {
  switch (answer.kind) {
    case 'rejection':
      return { kind: 'rejection', response: rejectionResponseOf(answer) };
    case 'fault': {
      const serviceFault = { ...party, kind: 'returned' as const, fault: answer };
      return { kind: 'fault', response: faultResponseOf(answer), serviceFault };
    }
  }
}

/** The invalid-input Rejection for Issues the Caller caused; one `serve` caused is its own bug. */
export function answeredOfInvalidInput(
  issues: readonly Issue[],
  party: Party,
  standards: StandardRejections,
): Answered {
  const runtimeIssues = issues.filter((issue) => !isInputPart(issue.part));
  if (runtimeIssues.length > 0) {
    const serviceFault = { ...party, kind: 'runtime-bug' as const, issues: runtimeIssues };
    return { kind: 'fault', response: runtimeBugResponse(), serviceFault };
  }
  const inputIssues = issues.filter(isInputIssue);
  return { kind: 'rejection', response: invalidInputResponseOf(inputIssues, standards) };
}

function isInputIssue(issue: Issue): issue is Issue & InputIssue {
  return isInputPart(issue.part);
}
