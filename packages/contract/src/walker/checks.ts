import { emptyConstraintOf } from './bounds.ts';
import { isFiniteNumber } from './canonical-json.ts';
import { type Constraint, type ConstraintOf, constraintOfType } from './check-constraints.ts';
import { type DeclaredCheck, isConditional, refusedCheck } from './check-defs.ts';
import type { NotAllowed } from './nodes.ts';
import {
  notAllowed,
  refused,
  refusedCheckOnNullable,
  refusedRepeatedCheck,
} from './not-allowed.ts';
import { failed, type Outline, outlineOf, type Reached, type Walked, walked } from './walked.ts';

/**
 * A walked schema with the constraint of each of its checks, by what its node's type takes; a
 * failed walk gains the checks' refusals, judged by the node it was building, beside its failures.
 */
export function constrain(
  walkedSchema: Walked,
  checks: readonly DeclaredCheck[],
  at: Reached,
): Walked {
  const outline = outlineOf(walkedSchema);
  const taken = constraintOfType(outline.type);
  const constraints = constraintsOf(outline.nullable ? refusedOnNull(taken) : taken, checks, at);
  const constrainedOutline = constrained(outline, constraints);
  const failures = [
    ...failuresOfConstraints(constraints, Object.keys(outline), at),
    ...emptinessFailuresOf(constrainedOutline, at),
  ];
  if (walkedSchema.kind === 'not-allowed') {
    return failed([...walkedSchema.failures, ...failures], constrainedOutline);
  }
  if (failures.length > 0) {
    return failed(failures, constrainedOutline);
  }
  return walked(constrained(walkedSchema.value, constraints));
}

/** Why the constrained node admits no value, as its bounds alone say. */
function emptinessFailuresOf(outline: Outline, at: Reached): readonly NotAllowed[] {
  const refusal = emptyConstraintOf(outline);
  return refusal === undefined ? [] : [{ kind: 'not-allowed', ...at, ...refusal }];
}

/**
 * A constraint a check sets, refused when its schema admits `null`: zod runs the check on `null`
 * too, where the node holds a constraint for the other values alone.
 */
function refusedOnNull<Node>(constraintOf: ConstraintOf<Node>): ConstraintOf<Node> {
  return (check, at) => {
    const constraint = constraintOf(check, at);
    if (constraint.kind === 'not-allowed') {
      return constraint;
    }
    return notAllowed(at, refusedCheckOnNullable(refusedCheck(check.def).construct));
  };
}

/** What each check sets, or why it is refused: a conditional check is refused on any type. */
function constraintsOf<Node>(
  constraintOf: ConstraintOf<Node>,
  checks: readonly DeclaredCheck[],
  at: Reached,
): readonly Constraint<Node>[] {
  return checks.map((check) =>
    isConditional(check) ? notAllowed(at, refused.conditionalCheck) : constraintOf(check, at),
  );
}

/** The node with every constraint that was walked set on it. */
function constrained<Node extends Outline>(
  node: Node,
  constraints: readonly Constraint<object>[],
): Node {
  let constrainedNode = node;
  for (const constraint of constraints) {
    if (constraint.kind === 'walked') {
      constrainedNode = { ...constrainedNode, ...constraint.value };
    }
  }
  return constrainedNode;
}

/** Every constraint refused, not finite, or set twice, given the keys the node already holds. */
function failuresOfConstraints(
  constraints: readonly Walked<object>[],
  nodeKeys: readonly string[],
  at: Reached,
): NotAllowed[] {
  const failures: NotAllowed[] = [];
  const taken = new Set(nodeKeys.map(slotOf));
  for (const constraint of constraints) {
    if (constraint.kind === 'not-allowed') {
      failures.push(...constraint.failures);
      continue;
    }
    if (Object.values(constraint.value).some(isNonFinite)) {
      failures.push({ kind: 'not-allowed', ...at, ...refused.nonFinite });
    }
    const slots = Object.keys(constraint.value).map(slotOf);
    const repeated = slots.find((slot) => taken.has(slot));
    if (repeated !== undefined) {
      failures.push({ kind: 'not-allowed', ...at, ...refusedRepeatedCheck(repeated) });
    }
    for (const slot of slots) {
      taken.add(slot);
    }
  }
  return failures;
}

/** The constraint a key sets: an exclusive bound is the same lower or upper bound. */
function slotOf(key: string): string {
  if (key === 'min' || key === 'exclusiveMin') {
    return 'a lower bound';
  }
  return key === 'max' || key === 'exclusiveMax' ? 'an upper bound' : key;
}

function isNonFinite(value: unknown): boolean {
  return typeof value === 'number' && !isFiniteNumber(value);
}
