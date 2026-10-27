import { type DeclaredCheck, refusedCheck } from './check-defs.ts';
import type { NumberNode, Regex, SchemaNode, StringNode } from './nodes.ts';
import { notAllowed, refusedName } from './not-allowed.ts';
import { formatOf } from './string-formats.ts';
import { type Reached, type Walked, walked } from './walked.ts';

/** The constraint a check sets on a node of one type, or why it is refused. */
export type Constraint<Node> = Walked<Partial<Node>>;

/** How a node of one type reads a check. */
export type ConstraintOf<Node> = (check: DeclaredCheck, at: Reached) => Constraint<Node>;

type Bounds = { readonly min?: number; readonly max?: number };

/** The constraint a check sets on a node of each type; one that takes no check refuses them all. */
export function constraintOfType(type: SchemaNode['type'] | undefined): ConstraintOf<object> {
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

function stringConstraint(check: DeclaredCheck, at: Reached): Constraint<StringNode> {
  const { def } = check;
  if (def.check !== 'string_format') {
    return lengthConstraint(check, at);
  }
  if (def.format === 'regex' && def.pattern !== undefined) {
    return walked({ regex: regexOf(def.pattern) });
  }
  return formatOf(check, at);
}

function lengthConstraint({ def: check }: DeclaredCheck, at: Reached): Constraint<Bounds> {
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

function numberConstraint({ def: check }: DeclaredCheck, at: Reached): Constraint<NumberNode> {
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

function refusedConstraint({ def }: DeclaredCheck, at: Reached): Constraint<never> {
  return notAllowed(at, refusedCheck(def));
}

function regexOf(pattern: RegExp): Regex {
  return { source: pattern.source, flags: pattern.flags };
}
