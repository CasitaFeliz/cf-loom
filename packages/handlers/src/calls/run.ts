import type { Endpoint, Guard, StandardRejections } from '@casitafeliz/loom-contract';
import { attachedGuardsOf } from '@casitafeliz/loom-contract/internal';
import {
  type Checked,
  checkedAll,
  checkedContext,
  checkedDemands,
  checkedInput,
  checkedQualifier,
  type Issue,
} from '../checks/index.ts';
import type { ResolvedAdmission, ResolvedOutcome } from '../outcomes/index.ts';
import {
  builtOf,
  endpointKinds,
  guardKinds,
  resolvedAdmissionOf,
  resolvedOutcomeOf,
} from './built.ts';

/** An implementation as the runtime calls it, whatever Element it was written for. */
export type Implementation = (...given: readonly unknown[]) => unknown;

/** What a Handler was written with: its Element and its implementation. */
export type Written<Element extends Endpoint | Guard> = {
  readonly element: Element;
  readonly implementation: Implementation;
};

/** What one call of an EndpointHandler is given, before it is checked. */
export type EndpointCall = { readonly input: unknown; readonly context: unknown };

/** What one call of a GuardHandler is given, before it is checked. */
export type GuardCall = {
  readonly demands: unknown;
  readonly context: unknown;
  readonly qualifier: unknown;
};

/** How one call went: given what breaks the Contract, built what breaks it, or answered. */
export type Run<Answer> =
  | { readonly kind: 'invalid-input'; readonly issues: readonly Issue[] }
  | { readonly kind: 'invalid-outcome'; readonly issues: readonly Issue[] }
  | { readonly kind: 'answered'; readonly outcome: Answer };

/** How one call of an EndpointHandler went, as `serve` answers it. */
export type EndpointRun<Target extends Endpoint = Endpoint> = Run<ResolvedOutcome<Target>>;

/** How one call of a GuardHandler went, as `serve` answers it. */
export type GuardRun<Target extends Guard = Guard> = Run<ResolvedAdmission<Target>>;

/** Runs one call of an EndpointHandler: checks what it is given and what it builds, then resolves. */
export async function endpointRunOf<Target extends Endpoint>(
  written: Written<Target>,
  call: EndpointCall,
  standards: StandardRejections,
): Promise<EndpointRun<Target>> {
  const { element: endpoint, implementation } = written;
  const given = checkedAll({
    input: checkedInput(endpoint, call.input),
    context: checkedContext(attachedGuardsOf(endpoint), call.context),
  });
  if (given.kind === 'issues') {
    return { kind: 'invalid-input', issues: given.issues };
  }
  const { input, context } = given.value;
  const built = await builtOf(endpoint, () => implementation(input, context), endpointKinds);
  return answeredRunOf(resolvedOutcomeOf(endpoint, built, standards));
}

/** Runs one call of a GuardHandler: checks what it is given and what it admits, then resolves. */
export async function guardRunOf<Target extends Guard>(
  written: Written<Target>,
  call: GuardCall,
  standards: StandardRejections,
): Promise<GuardRun<Target>> {
  const { element: guard, implementation } = written;
  const given = checkedAll({
    demands: checkedDemands(guard, call.demands),
    context: checkedContext(guard.guards ?? [], call.context),
    qualifier: checkedQualifier(guard, call.qualifier),
  });
  if (given.kind === 'issues') {
    return { kind: 'invalid-input', issues: given.issues };
  }
  const { demands, context, qualifier } = given.value;
  const run = () => implementation(demands, context, qualifier);
  const built = await builtOf(guard, run, guardKinds);
  return answeredRunOf(resolvedAdmissionOf(guard, built, standards));
}

/** A checked answer as a run; once checked, it is the answer its Element's type describes. */
function answeredRunOf<Answer>(checked: Checked<unknown>): Run<Answer> {
  if (checked.kind === 'issues') {
    return { kind: 'invalid-outcome', issues: checked.issues };
  }
  return { kind: 'answered', outcome: checked.value as Answer };
}
