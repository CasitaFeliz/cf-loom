import type * as core from 'zod/v4/core';
import { isOpen } from '../open.ts';
import { byCanonicalJson, canonicalJson } from './canonical-json.ts';
import type { JsonPrimitive, ObjectNode, Path, SchemaNode, Walked, Walker } from './nodes.ts';
import { allWalked, notAllowed, refused, walked } from './not-allowed.ts';

/** An enum of string values, open when `openEnum()` returned this very schema. */
export function walkEnum(schema: core.$ZodEnum, at: Path): Walked {
  const values: readonly unknown[] = Object.values(schema._zod.def.entries);
  const strings = values.filter(isString);
  if (strings.length !== values.length) {
    return notAllowed(at, refused.numericEnum);
  }
  return walked({ type: 'enum', values: strings.sort(byCanonicalJson), open: isOpen(schema) });
}

/**
 * A `tagged` node for a discriminated union, an `enum` for a union of literals, else a
 * `union` of its options in canonical order.
 */
export function walkUnion(schema: core.$ZodUnion, at: Path, walker: Walker): Walked {
  const def: core.$ZodUnionDef | core.$ZodDiscriminatedUnionDef = schema._zod.def;
  if ('discriminator' in def) {
    return walkTagged(schema as core.$ZodDiscriminatedUnion, at, walker);
  }
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

function walkTagged(schema: core.$ZodDiscriminatedUnion, at: Path, walker: Walker): Walked {
  const def = schema._zod.def;
  const variants = allWalked(
    def.options.map((option, index) => {
      const variantAt = [...at, 'variants', index];
      return taggedVariant(walker.schema(option, variantAt), def.discriminator, variantAt);
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
    open: isOpen(schema),
  });
}

function taggedVariant(
  variant: Walked,
  discriminator: string,
  at: Path,
): Walked<[string, ObjectNode]> {
  if (variant.kind === 'not-allowed') {
    return variant;
  }
  const node = variant.value;
  const field = node.type === 'object' ? node.fields[discriminator] : undefined;
  if (field?.schema.type === 'enum') {
    return notAllowed(at, refused.severalDiscriminatorValues);
  }
  if (node.type !== 'object' || field?.schema.type !== 'literal' || !field.required) {
    return notAllowed(at, refused.unliteralDiscriminator);
  }
  return walked([canonicalJson(field.schema.value), node]);
}

function choiceOf(options: readonly SchemaNode[]): SchemaNode {
  const literals = options.filter(isBareLiteral);
  if (literals.length !== options.length) {
    return { type: 'union', options: [...options].sort(byCanonicalJson) };
  }
  const values = literals.map((literal) => literal.value);
  const distinct = [...new Map(values.map((value) => [canonicalJson(value), value])).values()];
  return { type: 'enum', values: distinct.sort(byCanonicalJson), open: false };
}

function isBareLiteral(
  node: SchemaNode,
): node is { readonly type: 'literal'; readonly value: JsonPrimitive } {
  return node.type === 'literal' && Object.keys(node).length === 2;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
