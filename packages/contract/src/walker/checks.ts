import type * as core from 'zod/v4/core';
import type {
  ArrayNode,
  NotAllowed,
  NumberNode,
  Path,
  Regex,
  SchemaNode,
  StringNode,
} from './nodes.ts';
import {
  notAllowed,
  type Refused,
  refused,
  refusedName,
  refusedRepeatedCheck,
} from './not-allowed.ts';
import { formatOf } from './string-formats.ts';
import { type Walked, walked } from './walked.ts';

/** A check as zod's def writes it; `describe` and `meta` are how `zod/mini` sets metadata. */
export type CheckDef =
  | (core.$ZodChecks | core.$ZodStringFormatChecks)['_zod']['def']
  | { readonly check: 'custom'; readonly type?: 'custom' }
  | { readonly check: 'describe' | 'meta' };

type Constraint<Node> = Walked<Partial<Node>>;

type Bounds = { readonly min?: number; readonly max?: number };

/** The checks a schema declares, its own first: a format schema such as `z.email()` is a check. */
export function checksOf(def: core.$ZodTypeDef): readonly CheckDef[] {
  const own = 'check' in def ? [def as CheckDef] : [];
  const listed = (def.checks ?? []).map((check) => check._zod.def as CheckDef);
  return [...own, ...listed].filter(isConstraintCheck);
}

/** A string node with the constraint of each check, or the checks a string does not take. */
export function constrainString(node: StringNode, checks: readonly CheckDef[], at: Path): Walked {
  return constrained(
    node,
    checks.map((check) => stringConstraint(check, at)),
    at,
  );
}

/** A number node with the constraint of each check; `z.int()` is `int: true` and nothing more. */
export function constrainNumber(node: NumberNode, checks: readonly CheckDef[], at: Path): Walked {
  return constrained(
    node,
    checks.map((check) => numberConstraint(check, at)),
    at,
  );
}

/** An array node with the length bound of each check. */
export function constrainArray(node: ArrayNode, checks: readonly CheckDef[], at: Path): Walked {
  return constrained(
    node,
    checks.map((check) => lengthConstraint(check, at)),
    at,
  );
}

/** A node that takes no check: each declared check fails. */
export function unconstrained(node: SchemaNode, checks: readonly CheckDef[], at: Path): Walked {
  return constrained(
    node,
    checks.map((check) => notAllowed(at, refusedCheck(check))),
    at,
  );
}

function constrained<Node extends SchemaNode>(
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
    const repeated = Object.keys(constraint.value).find((key) => key in constrainedNode);
    if (repeated !== undefined) {
      failures.push({ at, ...refusedRepeatedCheck(repeated) });
    }
    constrainedNode = { ...constrainedNode, ...constraint.value };
  }
  return failures.length > 0 ? { kind: 'not-allowed', failures } : walked(constrainedNode);
}

function stringConstraint(check: CheckDef, at: Path): Constraint<StringNode> {
  if (check.check !== 'string_format') {
    return lengthConstraint(check, at);
  }
  if (check.format === 'regex' && check.pattern !== undefined) {
    return walked({ regex: regexOf(check.pattern) });
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

function isNonFinite(value: unknown): boolean {
  return typeof value === 'number' && !Number.isFinite(value);
}

function regexOf(pattern: RegExp): Regex {
  return { source: pattern.source, flags: pattern.flags };
}

function isConstraintCheck(check: CheckDef): boolean {
  return check.check !== 'describe' && check.check !== 'meta';
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the name of each check zod has
function refusedCheck(check: CheckDef): Refused {
  switch (check.check) {
    case 'custom':
      return check.type === 'custom' ? refused.refine : refused.customCheck;
    case 'overwrite':
      return refused.mutating;
    case 'string_format':
      return refusedName(check.format);
    case 'less_than':
      return refusedName('lt');
    case 'greater_than':
      return refusedName('gt');
    case 'multiple_of':
      return refusedName('multipleOf');
    case 'number_format':
    case 'bigint_format':
      return refusedName(check.format);
    case 'max_size':
      return refusedName('maxSize');
    case 'min_size':
      return refusedName('minSize');
    case 'size_equals':
      return refusedName('size');
    case 'max_length':
      return refusedName('maxLength');
    case 'min_length':
      return refusedName('minLength');
    case 'length_equals':
      return refusedName('length');
    case 'property':
      return refusedName('property');
    case 'mime_type':
      return refusedName('mime');
    case 'describe':
    case 'meta':
      return refusedName(check.check);
  }
}
