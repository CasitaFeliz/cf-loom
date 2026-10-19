import type * as core from 'zod/v4/core';
import { isOpen } from '../open/index.ts';
import { byCanonicalJson, canonicalJson, isJsonPrimitive } from './canonical-json.ts';
import { innerOfLazy } from './lazy.ts';
import type {
  EnumNode,
  JsonPrimitive,
  LiteralNode,
  ObjectNode,
  Path,
  RefNode,
  SchemaNode,
  TaggedNode,
} from './nodes.ts';
import { notAllowed, type Refused, refused } from './not-allowed.ts';
import { allWalked, type Walked, type Walker, walked } from './walked.ts';

/** An enum of string values, open when `openEnum()` returned this very schema. */
export function walkEnum(schema: core.$ZodEnum, at: Path): Walked {
  const values: readonly unknown[] = Object.values(schema._zod.def.entries);
  const strings = values.filter(isString);
  if (strings.length !== values.length) {
    return notAllowed(at, refused.numericEnum);
  }
  return walked({ ...enumOf(strings), open: isOpen(schema) });
}

/** An `enum` for a union of literals, else a `union` of its options in canonical order. */
export function walkUnion(schema: core.$ZodUnion, at: Path, walker: Walker): Walked {
  const def = schema._zod.def;
  if (def.inclusive === false) {
    return notAllowed(at, refused.xor);
  }
  const options = allWalked(
    def.options.map((option, index) => walker.schema(option, [...at, 'options', index])),
  );
  if (options.kind === 'not-allowed') {
    return options;
  }
  return walked(choiceOf(options.value));
}

/** A `tagged` node, its variants keyed by the canonical JSON of their discriminator value. */
export function walkTagged(schema: core.$ZodDiscriminatedUnion, at: Path, walker: Walker): Walked {
  const def = schema._zod.def;
  const variants = allWalked(
    def.options.map((option, index) => {
      const variantAt = [...at, 'variants', index];
      const refusal = variantRefusalOf(option, def.discriminator);
      if (refusal !== undefined) {
        return notAllowed(variantAt, refusal);
      }
      const values = option._zod.propValues?.[def.discriminator];
      return taggedVariant(walker.schema(option, variantAt), values, variantAt);
    }),
  );
  if (variants.kind === 'not-allowed') {
    return variants;
  }
  const keys = variants.value.map(([key]) => key);
  if (new Set(keys).size !== keys.length) {
    return notAllowed(at, refused.duplicateDiscriminatorValue);
  }
  return walked({
    type: 'tagged',
    discriminator: def.discriminator,
    variants: Object.fromEntries(variants.value),
  });
}

/**
 * A variant keyed by its discriminator value, as zod itself reads it from the variant, so a
 * `ref` to an object def keys like the object.
 */
function taggedVariant(
  variant: Walked,
  values: ReadonlySet<unknown> | undefined,
  at: Path,
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
 * A union of literals is always an enum: it carries only its own annotations, like a merged
 * intersection, and is nullable when any of its literals is.
 */
function choiceOf(options: readonly SchemaNode[]): SchemaNode {
  const literals = options.filter(isLiterals);
  if (literals.length !== options.length) {
    return { type: 'union', options: [...options].sort(byCanonicalJson) };
  }
  const values = enumOf(literals.flatMap(valuesOf));
  return literals.some((literal) => literal.nullable === true)
    ? { ...values, nullable: true }
    : values;
}

function valuesOf(literals: LiteralNode | EnumNode): readonly JsonPrimitive[] {
  return literals.type === 'literal' ? [literals.value] : literals.values;
}

/** An enum of several literal values, each once, in canonical order. */
export function enumOf(values: readonly JsonPrimitive[]): EnumNode {
  const valueByJson = new Map(values.map((value) => [canonicalJson(value), value]));
  const distinct = [...valueByJson.values()];
  return { type: 'enum', values: distinct.sort(byCanonicalJson), open: false };
}

/** A literal of one value, or a closed enum, which is how a literal of several values walks. */
function isLiterals(node: SchemaNode): node is LiteralNode | EnumNode {
  return node.type === 'literal' || (node.type === 'enum' && !node.open);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
