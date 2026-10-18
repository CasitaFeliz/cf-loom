import type { Endpoint, Guard, StandardRejections } from '@casitafeliz/loom-contract';
import {
  type Checked,
  checkedAdmission,
  checkedEndpointCall,
  checkedGuardCall,
  checkedOutcome,
  type EndpointGiven,
  type GuardGiven,
  type Issue,
} from '../checks/index.ts';
import {
  type Fault,
  isAdmission,
  isOutcome,
  type ResolvedAdmission,
  type ResolvedOutcome,
} from '../outcomes/index.ts';
import { ranOf } from './implementation.ts';

/** An implementation as the runtime calls it, whatever Endpoint or Guard it was written for. */
export type Implementation = (...given: readonly unknown[]) => unknown;

/** What a Handler was written with: its Endpoint or Guard, its implementation, and whether it is a stub. */
export type Written<Answering extends Endpoint | Guard> = {
  readonly element: Answering;
  readonly implementation: Implementation;
  readonly stub: boolean;
};

/**
 * How one call went: given what breaks the Contract, built what breaks it, threw or returned no
 * Outcome, or answered.
 */
export type Run<Answer> =
  | { readonly kind: 'invalid-input'; readonly issues: readonly Issue[] }
  | { readonly kind: 'invalid-outcome'; readonly issues: readonly Issue[] }
  | { readonly kind: 'thrown'; readonly fault: Fault }
  | { readonly kind: 'answered'; readonly answer: Answer };

/**
 * How one call of an EndpointHandler went, as `serve` answers it. Inside `serve`, an Issue at
 * `context` is the runtime's own bug, which `serve` answers as a Fault and reports to `onFault`.
 */
export type EndpointRun = Run<ResolvedOutcome<Endpoint>>;

/**
 * How one call of a GuardHandler went, as `serve` answers it. Inside `serve`, an Issue at
 * `context` or `qualifier` is the runtime's own bug, which `serve` answers as a Fault and reports
 * to `onFault`.
 */
export type GuardRun = Run<ResolvedAdmission<Guard>>;

/** Runs one call of an EndpointHandler: checks what it is given and what it builds, then resolves. */
export async function endpointRunOf(
  written: Written<Endpoint>,
  given: EndpointGiven,
  standards: StandardRejections,
): Promise<EndpointRun> {
  const { element: endpoint, implementation } = written;
  const checked = checkedEndpointCall(endpoint, given);
  if (checked.kind === 'issues') {
    return { kind: 'invalid-input', issues: checked.issues };
  }
  const { input, context } = checked.value;
  const ran = await ranOf(endpoint, () => implementation(input, context), isOutcome);
  if (ran.kind === 'thrown') {
    return ran;
  }
  return answeredRunOf(checkedOutcome(endpoint, ran.built, standards));
}

/** Runs one call of a GuardHandler: checks what it is given and what it admits, then resolves. */
export async function guardRunOf(
  written: Written<Guard>,
  given: GuardGiven,
  standards: StandardRejections,
): Promise<GuardRun> {
  const { element: guard, implementation } = written;
  const checked = checkedGuardCall(guard, given);
  if (checked.kind === 'issues') {
    return { kind: 'invalid-input', issues: checked.issues };
  }
  const { demands, context, qualifier } = checked.value;
  const run = () => implementation(demands, context, qualifier);
  const ran = await ranOf(guard, run, isAdmission);
  if (ran.kind === 'thrown') {
    return ran;
  }
  return answeredRunOf(checkedAdmission(guard, ran.built, standards));
}

function answeredRunOf<Answer>(checked: Checked<Answer>): Run<Answer> {
  if (checked.kind === 'issues') {
    return { kind: 'invalid-outcome', issues: checked.issues };
  }
  return { kind: 'answered', answer: checked.value };
}
