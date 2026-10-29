import type { DeclaredCheck } from './check-defs.ts';
import { refusedCheck } from './check-names.ts';
import type { NumberNode, SchemaNode, StringNode } from './nodes.ts';
import { notAllowed } from './not-allowed.ts';
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
      return refusedHere;
  }
}

function stringConstraint(check: DeclaredCheck, at: Reached): Constraint<StringNode> {
  const { def } = check;
  return def.check === 'string_format' ? formatOf(check, at) : lengthConstraint(check, at);
}

function lengthConstraint(check: DeclaredCheck, at: Reached): Constraint<Bounds> {
  const { def } = check;
  switch (def.check) {
    case 'min_length':
      return walked({ min: def.minimum });
    case 'max_length':
      return walked({ max: def.maximum });
    case 'length_equals':
      return walked({ min: def.length, max: def.length });
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
    case 'properties':
    case 'mime_type':
    case 'overwrite':
    case 'custom':
    case 'describe':
    case 'meta':
      return refusedHere(check, at);
  }
}

function numberConstraint(check: DeclaredCheck, at: Reached): Constraint<NumberNode> {
  const { def } = check;
  switch (def.check) {
    case 'greater_than':
      return walked(
        def.inclusive ? { min: Number(def.value) } : { exclusiveMin: Number(def.value) },
      );
    case 'less_than':
      return walked(
        def.inclusive ? { max: Number(def.value) } : { exclusiveMax: Number(def.value) },
      );
    case 'multiple_of':
      return walked({ multipleOf: Number(def.value) });
    case 'number_format':
      return def.format === 'safeint' ? walked({ int: true }) : refusedHere(check, at);
    case 'bigint_format':
    case 'max_size':
    case 'min_size':
    case 'size_equals':
    case 'max_length':
    case 'min_length':
    case 'length_equals':
    case 'string_format':
    case 'property':
    case 'properties':
    case 'mime_type':
    case 'overwrite':
    case 'custom':
    case 'describe':
    case 'meta':
      return refusedHere(check, at);
  }
}

/**
 * A check a node does not take, refused by the name its own type gives it: a string format the
 * string node refuses is refused as it would, any other by its row.
 */
function refusedHere(check: DeclaredCheck, at: Reached): Constraint<never> {
  if (check.def.check === 'string_format') {
    const onString = formatOf(check, at);
    if (onString.kind === 'not-allowed') {
      return onString;
    }
  }
  return notAllowed(at, refusedCheck(check.def));
}
