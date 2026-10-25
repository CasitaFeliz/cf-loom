import { isFiniteNumber } from './canonical-json.ts';
import { type DeclaredCheck, isConditional, refusedCheck } from './check-defs.ts';
import type { NotAllowed, NumberNode, Path, Regex, SchemaNode, StringNode } from './nodes.ts';
import { notAllowed, refused, refusedName, refusedRepeatedCheck } from './not-allowed.ts';
import { formatOf } from './string-formats.ts';
import { failed, type Outline, outlineOf, type Walked, walked } from './walked.ts';

type Constraint<Node> = Walked<Partial<Node>>;

type ConstraintOf<Node> = (check: DeclaredCheck, at: Path) => Constraint<Node>;

type Bounds = { readonly min?: number; readonly max?: number };

/**
 * A walked schema with the constraint of each of its checks, by what its node's type takes; a
 * failed walk gains the checks' refusals, judged by the node it was building, beside its failures.
 */
export function constrain(
  walkedSchema: Walked,
  checks: readonly DeclaredCheck[],
  at: Path,
): Walked {
  const outline = outlineOf(walkedSchema);
  const constraints = constraintsOf(constraintOfType(outline.type), checks, at);
  const failures = failuresOfConstraints(constraints, Object.keys(outline), at);
  if (walkedSchema.kind === 'not-allowed') {
    return failed([...walkedSchema.failures, ...failures], constrained(outline, constraints));
  }
  if (failures.length > 0) {
    return failed(failures, constrained(outline, constraints));
  }
  return walked(constrained(walkedSchema.value, constraints));
}

/** The constraint a check sets on a node of each type; one that takes no check refuses them all. */
function constraintOfType(type: SchemaNode['type'] | undefined): ConstraintOf<object> {
  switch (type) {
    case 'string':
      return stringConstraint;
    case 'number':
      return numberConstraint;
    case 'array':
      return lengthConstraint;
    case 'boolean':
    case 'enum':
    case 'object':
    case 'record':
    case 'tuple':
    case 'union':
    case 'tagged':
    case 'allOf':
    case 'json':
    case 'ref':
    case undefined:
      return refusedConstraint;
  }
}

/** What each check sets, or why it is refused: a conditional check is refused on any type. */
function constraintsOf<Node>(
  constraintOf: ConstraintOf<Node>,
  checks: readonly DeclaredCheck[],
  at: Path,
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
  at: Path,
): NotAllowed[] {
  const failures: NotAllowed[] = [];
  const taken = new Set(nodeKeys.map(slotOf));
  for (const constraint of constraints) {
    if (constraint.kind === 'not-allowed') {
      failures.push(...constraint.failures);
      continue;
    }
    if (Object.values(constraint.value).some(isNonFinite)) {
      failures.push({ kind: 'not-allowed', at, ...refused.nonFinite });
    }
    const slots = Object.keys(constraint.value).map(slotOf);
    const repeated = slots.find((slot) => taken.has(slot));
    if (repeated !== undefined) {
      failures.push({ kind: 'not-allowed', at, ...refusedRepeatedCheck(repeated) });
    }
    for (const slot of slots) {
      taken.add(slot);
    }
  }
  return failures;
}

function stringConstraint(check: DeclaredCheck, at: Path): Constraint<StringNode> {
  const { def } = check;
  if (def.check !== 'string_format') {
    return lengthConstraint(check, at);
  }
  if (def.format === 'regex' && def.pattern !== undefined) {
    return walked({ regex: regexOf(def.pattern) });
  }
  return formatOf(check, at);
}

function lengthConstraint({ def: check }: DeclaredCheck, at: Path): Constraint<Bounds> {
  switch (check.check) {
    case 'min_length':
      return walked({ min: check.minimum });
    case 'max_length':
      return walked({ max: check.maximum });
    case 'length_equals':
      return walked({ min: check.length, max: check.length });
    case 'less_than':
    case 'greater_than':
    case 'multiple_of':
    case 'number_format':
    case 'bigint_format':
    case 'max_size':
    case 'min_size':
    case 'size_equals':
    case 'string_format':
    case 'property':
    case 'mime_type':
    case 'overwrite':
    case 'custom':
    case 'describe':
    case 'meta':
      return notAllowed(at, refusedCheck(check));
  }
}

function numberConstraint({ def: check }: DeclaredCheck, at: Path): Constraint<NumberNode> {
  switch (check.check) {
    case 'greater_than':
      return walked(
        check.inclusive ? { min: Number(check.value) } : { exclusiveMin: Number(check.value) },
      );
    case 'less_than':
      return walked(
        check.inclusive ? { max: Number(check.value) } : { exclusiveMax: Number(check.value) },
      );
    case 'multiple_of':
      return walked({ multipleOf: Number(check.value) });
    case 'number_format':
      return check.format === 'safeint'
        ? walked({ int: true })
        : notAllowed(at, refusedName(check.format));
    case 'bigint_format':
    case 'max_size':
    case 'min_size':
    case 'size_equals':
    case 'max_length':
    case 'min_length':
    case 'length_equals':
    case 'string_format':
    case 'property':
    case 'mime_type':
    case 'overwrite':
    case 'custom':
    case 'describe':
    case 'meta':
      return notAllowed(at, refusedCheck(check));
  }
}

function refusedConstraint({ def }: DeclaredCheck, at: Path): Constraint<never> {
  return notAllowed(at, refusedCheck(def));
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

function regexOf(pattern: RegExp): Regex {
  return { source: pattern.source, flags: pattern.flags };
}
