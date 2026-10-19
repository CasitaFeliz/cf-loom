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
  fault,
  isAdmission,
  isOutcome,
  type ResolvedAdmission,
  type ResolvedOutcome,
  thrownFault,
} from '../outcomes/index.ts';
import { returnedOf } from './implementation.ts';

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

/**
 * Runs one call of an EndpointHandler: checks what it is given and what it builds, then resolves.
 * It never throws: anything thrown, by the implementation or while checking, is `thrown`.
 */
export function endpointRunOf(
  written: Written<Endpoint>,
  given: EndpointGiven,
  standards: StandardRejections,
): Promise<EndpointRun> {
  return caught(() => endpointCallOf(written, given, standards));
}

/**
 * Runs one call of a GuardHandler: checks what it is given and what it admits, then resolves.
 * It never throws: anything thrown, by the implementation or while checking, is `thrown`.
 */
export function guardRunOf(
  written: Written<Guard>,
  given: GuardGiven,
  standards: StandardRejections,
): Promise<GuardRun> {
  return caught(() => guardCallOf(written, given, standards));
}

async function caught<Answer>(run: () => Promise<Run<Answer>>): Promise<Run<Answer>> {
  try {
    return await run();
  } catch (e) {
    return { kind: 'thrown', fault: thrownFault(e) };
  }
}

async function endpointCallOf(
  { element: endpoint, implementation }: Written<Endpoint>,
  given: EndpointGiven,
  standards: StandardRejections,
): Promise<EndpointRun> {
  const checked = checkedGiven(() => checkedEndpointCall(endpoint, given));
  if (checked.kind !== 'value') {
    return checked;
  }
  const { input, context } = checked.value;
  const returned = await returnedOf(endpoint, () => implementation(input, context), isOutcome);
  if (returned.kind === 'thrown') {
    return returned;
  }
  return answeredRunOf(checkedOutcome(endpoint, returned.built, standards));
}

async function guardCallOf(
  { element: guard, implementation }: Written<Guard>,
  given: GuardGiven,
  standards: StandardRejections,
): Promise<GuardRun> {
  const checked = checkedGiven(() => checkedGuardCall(guard, given));
  if (checked.kind !== 'value') {
    return checked;
  }
  const { demands, context, qualifier } = checked.value;
  const run = () => implementation(demands, context, qualifier);
  const returned = await returnedOf(guard, run, isAdmission);
  if (returned.kind === 'thrown') {
    return returned;
  }
  return answeredRunOf(checkedAdmission(guard, returned.built, standards));
}

/**
 * What a call is given, checked; a throw while checking, such as a stack overflow on deep input, is
 * the Fault not committed, since the implementation never ran.
 */
function checkedGiven<Value>(
  check: () => Checked<Value>,
): { readonly kind: 'value'; readonly value: Value } | Exclude<Run<never>, { kind: 'answered' }> {
  try {
    const checked = check();
    if (checked.kind === 'issues') {
      return { kind: 'invalid-input', issues: checked.issues };
    }
    return checked;
  } catch (e) {
    return { kind: 'thrown', fault: fault({ committed: 'no', retryable: false, cause: e }) };
  }
}

function answeredRunOf<Answer>(checked: Checked<Answer>): Run<Answer> {
  if (checked.kind === 'issues') {
    return { kind: 'invalid-outcome', issues: checked.issues };
  }
  return { kind: 'answered', answer: checked.value };
}
