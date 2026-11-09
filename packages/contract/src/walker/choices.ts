import type * as core from 'zod/v4/core';
import { isOpen } from '../open/index.ts';
import { inCanonicalJsonOrder } from './canonical-json.ts';
import type { DefOfType } from './def-types.ts';
import { inside } from './location.ts';
import type { EnumNode, JsonPrimitive, SchemaNode } from './nodes.ts';
import { notAllowed, refused } from './not-allowed.ts';
import { optionStep } from './steps.ts';
import {
  allWalked,
  failed,
  failuresOf,
  type Outline,
  outlineOf,
  type Reached,
  type Walked,
  type Walker,
  type Walking,
  walked,
} from './walked.ts';

/** An enum of string values, open when `openEnum()` declared it or zod derived it from one. */
export function walkEnum(schema: core.$ZodEnum, at: Reached): Walked {
  const values: readonly unknown[] = Object.values(schema._zod.def.entries);
  const strings = values.filter(isString);
  if (strings.length !== values.length) {
    return notAllowed(at, refused.numericEnum);
  }
  const closed = enumOf(strings, at);
  if (closed.kind === 'not-allowed') {
    return failed(closed.tree);
  }
  return walked({ ...closed.value, open: isOpen(schema) });
}

/** An `enum` for a union of literals, else a `union` of its options in declared order. */
export function* walkUnion(def: DefOfType<'union'>, at: Reached, walker: Walker): Walking {
  if (def.options.length === 0) {
    return notAllowed(at, refused.emptyUnion);
  }
  const walkedOptions: Walked[] = [];
  for (const [index, option] of def.options.entries()) {
    walkedOptions.push(yield* walker.schema(option, inside(at, optionStep(index))));
  }
  const options = allWalked(walkedOptions);
  if (def.inclusive === false) {
    return failed(failuresOf([notAllowed(at, refused.xor), options]));
  }
  if (options.kind === 'not-allowed') {
    return failed(options.tree, unionOutlineOf(walkedOptions.map(outlineOf)));
  }
  return choiceOf(options.value, at);
}

/**
 * What a union that failed was building: a union of every option's outline, or nothing built when
 * its options other than unbuilt ones are all closed literals, since the fix of an unbuilt option
 * decides between an enum and a union, as `choiceOf` decides.
 */
function unionOutlineOf(options: readonly Outline[]): Outline | undefined {
  const built = options.filter((option) => option.type !== undefined);
  return built.every(isClosedEnum) ? undefined : { type: 'union', options };
}

/**
 * A union of closed literals is one enum: it carries only its own annotations, like a merged
 * intersection, and is nullable when any of its literals is. Any other union keeps its options in
 * declared order, since zod's union returns the first option that parses.
 */
function choiceOf(options: readonly SchemaNode[], at: Reached): Walked {
  const literals = options.filter(isClosedEnum);
  if (literals.length !== options.length) {
    return walked({ type: 'union', options: [...options] });
  }
  const values = enumOf(
    literals.flatMap((literal) => literal.values),
    at,
  );
  if (values.kind === 'not-allowed') {
    return failed(values.tree);
  }
  const nullable = literals.some((literal) => literal.nullable === true);
  return walked(nullable ? { ...values.value, nullable: true } : values.value);
}

/** A closed enum of literal values, each once, in canonical order; one without values is refused. */
export function enumOf(values: readonly JsonPrimitive[], at: Reached): Walked<EnumNode> {
  if (values.length === 0) {
    return notAllowed(at, refused.emptyEnum);
  }
  return walked({ type: 'enum', values: inCanonicalJsonOrder(values), open: false });
}

/** A closed enum, which is how a literal walks. */
function isClosedEnum(node: Outline): node is EnumNode {
  return node.type === 'enum' && !node.open;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
