import { type CheckDef, type DeclaredCheck, refusedCheck } from './check-defs.ts';
import type {
  ArrayNode,
  NotAllowed,
  NumberNode,
  Path,
  Regex,
  SchemaNode,
  StringNode,
} from './nodes.ts';
import { notAllowed, refused, refusedName, refusedRepeatedCheck } from './not-allowed.ts';
import { formatOf } from './string-formats.ts';
import { failed, type Walked, walked } from './walked.ts';

type Constraint<Node> = Walked<Partial<Node>>;

type Bounds = { readonly min?: number; readonly max?: number };

/** A string node with the constraint of each check, or the checks a string does not take. */
export function constrainString(
  node: StringNode,
  checks: readonly DeclaredCheck[],
  at: Path,
): Walked {
  return withConstraints(
    node,
    checks.map((check) => stringConstraint(check, at)),
    at,
  );
}

/** A number node with the constraint of each check; `z.int()` is `int: true` and nothing more. */
export function constrainNumber(
  node: NumberNode,
  checks: readonly DeclaredCheck[],
  at: Path,
): Walked {
  return withConstraints(
    node,
    checks.map((check) => numberConstraint(check.def, at)),
    at,
  );
}

/** An array node with the length bound of each check. */
export function constrainArray(
  node: ArrayNode,
  checks: readonly DeclaredCheck[],
  at: Path,
): Walked {
  return withConstraints(
    node,
    checks.map((check) => lengthConstraint(check.def, at)),
    at,
  );
}

/** A node that takes no check: each declared check fails. */
export function unconstrained(
  node: SchemaNode,
  checks: readonly DeclaredCheck[],
  at: Path,
): Walked {
  return withConstraints(
    node,
    checks.map((check) => notAllowed(at, refusedCheck(check.def))),
    at,
  );
}

function withConstraints<Node extends SchemaNode>(
  node: Node,
  constraints: readonly Constraint<Node>[],
  at: Path,
): Walked {
  const failures: NotAllowed[] = [];
  let constrainedNode: SchemaNode = node;
  for (const constraint of constraints) {
    if (constraint.kind === 'not-allowed') {
      failures.push(...constraint.failures);
      continue;
    }
    if (Object.values(constraint.value).some(isNonFinite)) {
      failures.push({ at, ...refused.nonFinite });
    }
    const taken = new Set(Object.keys(constrainedNode).map(slotOf));
    const repeated = Object.keys(constraint.value)
      .map(slotOf)
      .find((slot) => taken.has(slot));
    if (repeated !== undefined) {
      failures.push({ at, ...refusedRepeatedCheck(repeated) });
    }
    constrainedNode = { ...constrainedNode, ...constraint.value };
  }
  return failures.length > 0 ? failed(failures) : walked(constrainedNode);
}

function stringConstraint(check: DeclaredCheck, at: Path): Constraint<StringNode> {
  const { def } = check;
  if (def.check !== 'string_format') {
    return lengthConstraint(def, at);
  }
  if (def.format === 'regex' && def.pattern !== undefined) {
    return walked({ regex: regexOf(def.pattern) });
  }
  return formatOf(check, at);
}

function lengthConstraint(check: CheckDef, at: Path): Constraint<Bounds> {
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

function numberConstraint(check: CheckDef, at: Path): Constraint<NumberNode> {
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

/** The constraint a key sets: an exclusive bound is the same lower or upper bound. */
function slotOf(key: string): string {
  if (key === 'min' || key === 'exclusiveMin') {
    return 'a lower bound';
  }
  return key === 'max' || key === 'exclusiveMax' ? 'an upper bound' : key;
}

function isNonFinite(value: unknown): boolean {
  return typeof value === 'number' && !Number.isFinite(value);
}

function regexOf(pattern: RegExp): Regex {
  return { source: pattern.source, flags: pattern.flags };
}
