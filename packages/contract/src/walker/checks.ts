import { isFiniteNumber } from './canonical-json.ts';
import { type DeclaredCheck, isConditional, refusedCheck } from './check-defs.ts';
import type { NotAllowed, NumberNode, Path, Regex, SchemaNode, StringNode } from './nodes.ts';
import { notAllowed, refused, refusedName, refusedRepeatedCheck } from './not-allowed.ts';
import { formatOf } from './string-formats.ts';
import { failed, type Walked, walked } from './walked.ts';

type Constraint<Node> = Walked<Partial<Node>>;

type ConstraintOf<Node> = (check: DeclaredCheck, at: Path) => Constraint<Node>;

type Bounds = { readonly min?: number; readonly max?: number };

/** The node types that take checks, and `other` for every type that takes none. */
export type CheckedType = 'string' | 'number' | 'array' | 'other';

/** The constraint a check sets on each type of node, written once for every use of it. */
const constraintOfType = {
  string: stringConstraint,
  number: numberConstraint,
  array: lengthConstraint,
  other: refusedConstraint,
};

/** A node with the constraint of each check, by what its type takes. */
export function constrain(node: SchemaNode, checks: readonly DeclaredCheck[], at: Path): Walked {
  switch (node.type) {
    case 'string':
      return withConstraints(node, constraintsOf(constraintOfType.string, checks, at), at);
    case 'number':
      return withConstraints(node, constraintsOf(constraintOfType.number, checks, at), at);
    case 'array':
      return withConstraints(node, constraintsOf(constraintOfType.array, checks, at), at);
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
      return withConstraints(node, constraintsOf(constraintOfType.other, checks, at), at);
  }
}

/**
 * The checks refused on a schema whose walk left no node, judged as a node of the type its def
 * fixes would judge them.
 */
export function checkFailuresOf(
  type: CheckedType,
  checks: readonly DeclaredCheck[],
  at: Path,
): readonly NotAllowed[] {
  return failuresOfConstraints(constraintsOf<object>(constraintOfType[type], checks, at), [], at);
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

function withConstraints<Node extends SchemaNode>(
  node: Node,
  constraints: readonly Constraint<Node>[],
  at: Path,
): Walked {
  const failures = failuresOfConstraints(constraints, Object.keys(node), at);
  if (failures.length > 0) {
    return failed(failures);
  }
  let constrainedNode: SchemaNode = node;
  for (const constraint of constraints) {
    if (constraint.kind === 'walked') {
      constrainedNode = { ...constrainedNode, ...constraint.value };
    }
  }
  return walked(constrainedNode);
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
