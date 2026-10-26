import type * as core from 'zod/v4/core';
import { isOpen } from '../open/index.ts';
import { canonicalJson, inCanonicalJsonOrder, isJsonPrimitive } from './canonical-json.ts';
import { innerOfLazy } from './lazy.ts';
import { inside, type Place } from './location.ts';
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
  type Walked,
  type Walker,
  walked,
} from './walked.ts';

/** An enum of string values, open when `openEnum()` declared it or zod derived it from one. */
export function walkEnum(schema: core.$ZodEnum, at: Place): Walked {
  const values: readonly unknown[] = Object.values(schema._zod.def.entries);
  const strings = values.filter(isString);
  if (strings.length !== values.length) {
    return notAllowed(at, refused.numericEnum, { type: 'enum' });
  }
  const closed = enumOf(strings, at);
  if (closed.kind === 'not-allowed') {
    return failed(closed.failures, { type: 'enum' });
  }
  return walked({ ...closed.value, open: isOpen(schema) });
}

/** An `enum` for a union of literals, else a `union` of its options in declared order. */
export function walkUnion(schema: core.$ZodUnion, at: Place, walker: Walker): Walked {
  const def = schema._zod.def;
  if (def.options.length === 0) {
    return notAllowed(at, refused.emptyUnion, { type: 'union' });
  }
  const options = allWalked(
    def.options.map((option, index) => walker.schema(option, inside(at, optionStep(index)))),
  );
  if (def.inclusive === false) {
    return failed(failuresOf([notAllowed(at, refused.xor), options]), { type: 'union' });
  }
  if (options.kind === 'not-allowed') {
    return failed(options.failures, { type: 'union' });
  }
  return choiceOf(options.value, at);
}

/** A `tagged` node, its variants keyed by the canonical JSON of their discriminator value. */
export function walkTagged(schema: core.$ZodDiscriminatedUnion, at: Place, walker: Walker): Walked {
  const def = schema._zod.def;
  const tagged: Outline = { type: 'tagged' };
  if (def.options.length === 0) {
    return notAllowed(at, refused.emptyDiscriminatedUnion, tagged);
  }
  const variants = allWalked(
    def.options.map((option, index) => {
      const values = option._zod.propValues?.[def.discriminator];
      const variantAt = inside(at, variantStepOf(def.discriminator, values, index));
      const variant = walker.schema(option, variantAt);
      const refusal = variantRefusalOf(option, def.discriminator);
      if (refusal !== undefined) {
        return failed(failuresOf([notAllowed(variantAt, refusal), variant]));
      }
      return taggedVariant(variant, values, variantAt);
    }),
  );
  if (variants.kind === 'not-allowed') {
    return failed(variants.failures, tagged);
  }
  const keys = variants.value.map(([key]) => key);
  if (new Set(keys).size !== keys.length) {
    return notAllowed(at, refused.duplicateDiscriminatorValue, tagged);
  }
  return walked({
    type: 'tagged',
    discriminator: def.discriminator,
    variants: Object.fromEntries(variants.value),
  });
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
  at: Place,
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
function choiceOf(options: readonly SchemaNode[], at: Place): Walked {
  const literals = options.filter(isClosedEnum);
  if (literals.length !== options.length) {
    return walked({ type: 'union', options: [...options] });
  }
  const values = enumOf(
    literals.flatMap((literal) => literal.values),
    at,
  );
  if (values.kind === 'not-allowed') {
    return failed(values.failures, { type: 'enum' });
  }
  const nullable = literals.some((literal) => literal.nullable === true);
  return walked(nullable ? { ...values.value, nullable: true } : values.value);
}

/** A closed enum of literal values, each once, in canonical order; one without values is refused. */
export function enumOf(values: readonly JsonPrimitive[], at: Place): Walked<EnumNode> {
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
