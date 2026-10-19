import type { StandardRejections } from '@casitafeliz/loom-contract';
import {
  canTravelAsHeader,
  type InputIssue,
  invalidInputBodyOf,
  isInputPart,
  textOfValue,
} from '@casitafeliz/loom-contract/internal';
import type { Fault, Issue } from '@casitafeliz/loom-handlers';
import type { EndpointRun } from '@casitafeliz/loom-handlers/internal';
import {
  faultResponseOf,
  rejectionResponseOf,
  reservedResponseOf,
  runtimeBugResponse,
  type SentRejection,
  successResponseOf,
} from '../response/index.ts';
import type { AnsweredRequest, FaultedBy, ServiceFault } from './hooks.ts';

/** How one request was answered; only a Fault may be the Service's, for `onServiceFault`. */
export type Answered =
  | { readonly kind: Exclude<AnsweredRequest['kind'], 'fault'>; readonly response: Response }
  | { readonly kind: 'fault'; readonly response: Response; readonly serviceFault?: ServiceFault };

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
      const serviceFault = { ...faultedBy, kind: 'thrown' as const, fault: run.fault };
      return { kind: 'fault', response: faultResponseOf(run.fault), serviceFault };
    }
  }
}

/** A Success a Handler answered, sent only when each of its headers can travel as text. */
export function answeredOfSuccess(success: ResolvedSuccess, faultedBy: FaultedBy): Answered {
  const declared = Object.entries(success.headers ?? {}).filter(([, value]) => value !== undefined);
  const texts = declared.map(([name, value]) => [name, headerTextOf(value)] as const);
  const issues = texts
    .filter(([, text]) => text === undefined)
    .map(([name]) => headerIssueOf(name));
  if (issues.length > 0) {
    return invalidOutcomeOf(issues, faultedBy);
  }
  const headers = texts.filter(isTravelling);
  const response = successResponseOf({ status: success.status, headers, body: success.body });
  return { kind: 'success', response };
}

/** A Rejection or a Fault a Handler answered, as sent; a returned Fault is the Service's too. */
export function answeredOfNotSuccess(answer: NotSuccess, faultedBy: FaultedBy): Answered {
  switch (answer.kind) {
    case 'rejection':
      return { kind: 'rejection', response: rejectionResponseOf(answer) };
    case 'fault': {
      const serviceFault = { ...faultedBy, kind: 'returned' as const, fault: answer };
      return { kind: 'fault', response: faultResponseOf(answer), serviceFault };
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
    const serviceFault = { ...faultedBy, kind: 'runtime-bug' as const, issues: runtimeIssues };
    return { kind: 'fault', response: runtimeBugResponse(), serviceFault };
  }
  const body = invalidInputBodyOf(issues.filter(isInputIssue));
  const response = rejectionResponseOf({ ...standards.invalidInput, body });
  return { kind: 'rejection', response };
}

function invalidOutcomeOf(issues: readonly Issue[], faultedBy: FaultedBy): Answered {
  const serviceFault = { ...faultedBy, kind: 'invalid-outcome' as const, issues };
  return { kind: 'fault', response: reservedResponseOf('INVALID_OUTCOME'), serviceFault };
}

function headerIssueOf(name: string): Issue {
  const message = 'The header value cannot travel as HTTP text';
  return { part: 'success.headers', path: [name], code: 'invalid_format', message };
}

/** A Success header's value as the text it travels in, or none when it cannot travel. */
function headerTextOf(value: unknown): string | undefined {
  const isText =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  const text = isText ? textOfValue(value) : undefined;
  return text !== undefined && canTravelAsHeader(text) ? text : undefined;
}

function isTravelling(
  header: readonly [string, string | undefined],
): header is readonly [string, string] {
  return header[1] !== undefined;
}

function isInputIssue(issue: Issue): issue is InputIssue {
  return isInputPart(issue.part);
}
