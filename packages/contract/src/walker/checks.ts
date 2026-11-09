import { emptyConstraintOf } from './bounds.ts';
import { isFiniteNumber } from './canonical-json.ts';
import { type Constraint, type ConstraintOf, constraintOfType } from './check-constraints.ts';
import { type DeclaredCheck, isConditional } from './check-defs.ts';
import { isKnownCheckKind, refusedCheck } from './check-names.ts';
import type { NotAllowed } from './nodes.ts';
import {
  notAllowed,
  type Refused,
  refused,
  refusedCheckOnNullable,
  refusedCheckOnOptional,
  refusedRepeatedCheck,
} from './not-allowed.ts';
import {
  type FailureTree,
  failed,
  type Outline,
  outlineOf,
  type Reached,
  type Walked,
  walked,
} from './walked.ts';

/** What a schema is whose checks are judged: any schema, or the wrapper of a field. */
export type CheckedKind = 'schema' | 'optional' | 'nonoptional';

/** Where a schema's checks are judged, and what the schema is. */
export type CheckedAt = { readonly at: Reached; readonly kind: CheckedKind };

/**
 * A walked schema with the constraint of each of its checks, by what its node's type takes; a
 * failed walk gains the checks' refusals, judged by the node it was building, beside its failures.
 */
export function constrain(
  walkedSchema: Walked,
  checks: readonly DeclaredCheck[],
  { at, kind }: CheckedAt,
): Walked {
  const outline = outlineOf(walkedSchema);
  const constraints = constraintsOf(constraintOfSchema(outline, kind), checks, at);
  const constrainedOutline = constrained(outline, constraints);
  const failures = [
    ...failuresOfConstraints(constraints, Object.keys(outline), at),
    ...emptinessFailuresOf(constrainedOutline, at),
  ];
  if (walkedSchema.kind === 'not-allowed') {
    return failed([walkedSchema.tree, ...failures], constrainedOutline);
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
 * A check belongs to the schema it constrains, so where its schema admits more than its node
 * does, `null` or an absent field, the constraint is refused; on an `Unbuilt` part it is judged
 * as every replacement would judge it, whether the schema admits more or not.
 */
function constraintOfSchema(outline: Outline, kind: CheckedKind): ConstraintOf<object> {
  const taken = constraintOfType(outline.type);
  if (outline.type === undefined) {
    return taken;
  }
  switch (kind) {
    case 'optional':
      return refusedOnWiderSchema(taken, refusedCheckOnOptional);
    case 'nonoptional':
    case 'schema':
      return outline.nullable ? refusedOnWiderSchema(taken, refusedCheckOnNullable) : taken;
  }
}

/** A constraint a check would set on the node, refused as written on a schema that admits more. */
function refusedOnWiderSchema<Node>(
  constraintOf: ConstraintOf<Node>,
  refusal: (check: string) => Refused,
): ConstraintOf<Node> {
  return (check, at) => {
    const constraint = constraintOf(check, at);
    if (constraint.kind === 'not-allowed') {
      return constraint;
    }
    return notAllowed(at, refusal(refusedCheck(check.def).construct));
  };
}

/**
 * What each check sets, or why it is refused: a check of a kind zod added after this walker was
 * written, and a conditional check, are refused on any type.
 */
function constraintsOf<Node>(
  constraintOf: ConstraintOf<Node>,
  checks: readonly DeclaredCheck[],
  at: Reached,
): readonly Constraint<Node>[] {
  return checks.map((check) => {
    if (!isKnownCheckKind(check.def.check)) {
      return notAllowed(at, refusedCheck(check.def));
    }
    return isConditional(check)
      ? notAllowed(at, refused.conditionalCheck)
      : constraintOf(check, at);
  });
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
): FailureTree {
  const failures: (NotAllowed | FailureTree)[] = [];
  const taken = new Set(nodeKeys.map(slotOf));
  for (const constraint of constraints) {
    if (constraint.kind === 'not-allowed') {
      failures.push(constraint.tree);
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
