import type * as core from 'zod/v4/core';
import { isOpen } from '../open/index.ts';
import { canonicalJson, inCanonicalJsonOrder, isJsonPrimitive } from './canonical-json.ts';
import { innerOfLazy } from './lazy.ts';
import { inside } from './location.ts';
import type {
  EnumNode,
  JsonPrimitive,
  ObjectNode,
  RefNode,
  SchemaNode,
  TaggedNode,
} from './nodes.ts';
import { notAllowed, type Refused, refused } from './not-allowed.ts';
import { optionStep, type Step, variantStep } from './steps.ts';
import {
  allWalked,
  failed,
  failuresOf,
  type Outline,
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
    return notAllowed(at, refused.numericEnum, { type: 'enum' });
  }
  const closed = enumOf(strings, at);
  if (closed.kind === 'not-allowed') {
    return failed(closed.tree, { type: 'enum' });
  }
  return walked({ ...closed.value, open: isOpen(schema) });
}

/** An `enum` for a union of literals, else a `union` of its options in declared order. */
export function* walkUnion(schema: core.$ZodUnion, at: Reached, walker: Walker): Walking {
  const def = schema._zod.def;
  if (def.options.length === 0) {
    return notAllowed(at, refused.emptyUnion, { type: 'union' });
  }
  const walkedOptions: Walked[] = [];
  for (const [index, option] of def.options.entries()) {
    walkedOptions.push(yield* walker.schema(option, inside(at, optionStep(index))));
  }
  const options = allWalked(walkedOptions);
  if (def.inclusive === false) {
    return failed(failuresOf([notAllowed(at, refused.xor), options]), { type: 'union' });
  }
  if (options.kind === 'not-allowed') {
    return failed(options.tree, { type: 'union' });
  }
  return choiceOf(options.value, at);
}

/** A `tagged` node, its variants keyed by the canonical JSON of their discriminator value. */
export function* walkTagged(
  schema: core.$ZodDiscriminatedUnion,
  at: Reached,
  walker: Walker,
): Walking {
  const def = schema._zod.def;
  const tagged: Outline = { type: 'tagged' };
  if (def.options.length === 0) {
    return notAllowed(at, refused.emptyDiscriminatedUnion, tagged);
  }
  const duplicate = hasDuplicateValue(def)
    ? [notAllowed(at, refused.duplicateDiscriminatorValue)]
    : [];
  const walkedVariants: Walked<[string, TaggedNode['variants'][string]]>[] = [];
  for (const [index, option] of def.options.entries()) {
    walkedVariants.push(yield* walkVariant(option, index, { def, at, walker }));
  }
  const variants = allWalked(walkedVariants);
  if (variants.kind === 'not-allowed' || duplicate.length > 0) {
    return failed(failuresOf([...duplicate, variants]), tagged);
  }
  return walked({
    type: 'tagged',
    discriminator: def.discriminator,
    variants: Object.fromEntries(variants.value),
  });
}

/** The discriminated union a variant is walked in: its def, its place and the walker. */
type VariantOf = {
  readonly def: core.$ZodDiscriminatedUnionDef;
  readonly at: Reached;
  readonly walker: Walker;
};

/** A variant keyed by its discriminator value, or refused beside what it holds when it cannot be. */
function* walkVariant(
  option: core.$ZodType,
  index: number,
  { def, at, walker }: VariantOf,
): Walking<[string, TaggedNode['variants'][string]]> {
  const values = option._zod.propValues?.[def.discriminator];
  const variantAt = walker.reach(
    option,
    inside(at, variantStepOf(def.discriminator, values, index)),
  );
  const variant = yield* walker.schema(option, variantAt);
  const refusal = variantRefusalOf(option, def.discriminator);
  if (refusal !== undefined) {
    return failed(failuresOf([notAllowed(variantAt, refusal), variant]));
  }
  return taggedVariant(variant, values, variantAt);
}

/**
 * Whether two variants share a discriminator value, as zod reads each variant's values: judged
 * before the variants are walked, so it is told beside what they refuse.
 */
function hasDuplicateValue({ options, discriminator }: core.$ZodDiscriminatedUnionDef): boolean {
  const values = options.map((option) => [...(option._zod.propValues?.[discriminator] ?? [])]);
  const keys = values.filter(isOneValue).map(([value]) => canonicalJson(value));
  return new Set(keys).size !== keys.length;
}

function isOneValue(values: readonly unknown[]): values is [JsonPrimitive] {
  return values.length === 1 && isJsonPrimitive(values[0]);
}

/** A variant is told by its discriminator's one literal, else by its position among the options. */
function variantStepOf(
  discriminator: string,
  values: ReadonlySet<unknown> | undefined,
  index: number,
): Step {
  const literals = [...(values ?? [])];
  const [only] = literals;
  if (literals.length === 1 && isJsonPrimitive(only)) {
    return variantStep(discriminator, canonicalJson(only));
  }
  return optionStep(index);
}

/**
 * A variant keyed by its discriminator value, as zod itself reads it from the variant, so a
 * `ref` to an object def keys like the object.
 */
function taggedVariant(
  variant: Walked,
  values: ReadonlySet<unknown> | undefined,
  at: Reached,
): Walked<[string, TaggedNode['variants'][string]]> {
  if (variant.kind === 'not-allowed') {
    return variant;
  }
  const node = variant.value;
  if (!isTaggable(node)) {
    throw new Error('A variant already found to be an object walked to another node: a bug.');
  }
  const literals = [...(values ?? [])];
  if (literals.length === 0 || !literals.every(isJsonPrimitive)) {
    return notAllowed(at, refused.unliteralDiscriminator);
  }
  if (literals.length > 1) {
    return notAllowed(at, refused.severalDiscriminatorValues);
  }
  return walked([canonicalJson(literals[0]), node]);
}

/** A variant must be an object whose discriminator is a literal; a discriminated union in its place is named. */
function variantRefusalOf(option: core.$ZodType, discriminator: string): Refused | undefined {
  const def = innerOfLazy(option)._zod.def;
  if (def.type !== 'object') {
    return 'discriminator' in def ? refused.nestedDiscriminatedUnion : refused.objectlessVariant;
  }
  const { shape } = def as core.$ZodObjectDef;
  const field = Object.hasOwn(shape, discriminator) ? shape[discriminator] : undefined;
  const isLiteral = field !== undefined && innerOfLazy(field)._zod.def.type === 'literal';
  return isLiteral ? undefined : refused.unliteralDiscriminator;
}

function isTaggable(node: SchemaNode): node is ObjectNode | RefNode {
  return node.type === 'object' || node.type === 'ref';
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
    return failed(values.tree, { type: 'enum' });
  }
  const nullable = literals.some((literal) => literal.nullable === true);
  return walked(nullable ? { ...values.value, nullable: true } : values.value);
}

/** A closed enum of literal values, each once, in canonical order; one without values is refused. */
export function enumOf(values: readonly JsonPrimitive[], at: Reached): Walked<EnumNode> {
  if (values.length === 0) {
    return notAllowed(at, refused.emptyEnum, { type: 'enum' });
  }
  return walked({ type: 'enum', values: inCanonicalJsonOrder(values), open: false });
}

/** A closed enum, which is how a literal walks. */
function isClosedEnum(node: SchemaNode): node is EnumNode {
  return node.type === 'enum' && !node.open;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
