import * as core from 'zod/v4/core';
import { type Def, type DefOfType, defOf, isSchema, isTaggedDef } from './def-types.ts';
import { innerOfLazy, innerOfOneLazy } from './lazy.ts';
import { type Refused, refused } from './not-allowed.ts';

/**
 * What a variant says of its discriminator: the values zod reads from it, and why it cannot be a
 * variant. A variant or a discriminator that is no zod 4 schema says neither: its own walk
 * refuses it.
 */
export type Discriminator = {
  readonly values: ReadonlySet<unknown> | undefined;
  readonly refusal: Refused | undefined;
};

/**
 * The one read of a variant's discriminator, from zod 4 schemas alone, so a variant that holds a
 * value that is no schema never reaches zod's own `propValues`, which reads what lies inside it.
 */
export function discriminatorOf(option: unknown, key: string): Discriminator {
  return { values: valuesOf(option, key), refusal: refusalOf(option, key) };
}

/** A variant must be an object whose discriminator is a literal; a union in its place is named. */
function refusalOf(option: unknown, key: string): Refused | undefined {
  const variant = defOf(innerOfLazy(option));
  if (variant === undefined) {
    return undefined;
  }
  if (variant.type !== 'object') {
    return isTaggedDef(variant) ? refused.nestedDiscriminatedUnion : refused.objectlessVariant;
  }
  const field = fieldOf(variant, key);
  const discriminator = defOf(innerOfLazy(field));
  if (field !== undefined && discriminator === undefined) {
    return undefined;
  }
  return discriminator?.type === 'literal' ? undefined : refused.unliteralDiscriminator;
}

function fieldOf(variant: DefOfType<'object'>, key: string): unknown {
  return Object.hasOwn(variant.shape, key) ? variant.shape[key] : undefined;
}

/** The def types zod reads values through, for a variant and for a discriminator. */
const variantForwarding: ReadonlySet<string> = new Set(['lazy', 'readonly', 'pipe']);
const fieldForwarding: ReadonlySet<string> = new Set(['readonly', 'pipe']);

/** The def zod reads values from, through the wrappers that forward them; none for no schema. */
function forwardedDefOf(value: unknown, forwarding: ReadonlySet<string>): Def | undefined {
  const met = new Set<unknown>();
  let current = value;
  while (isSchema(current) && !met.has(current)) {
    const def = defOf(current);
    if (!forwarding.has(def.type)) {
      return def;
    }
    met.add(current);
    current = nextOf(current, def);
  }
  return defOf(current);
}

function nextOf(schema: core.$ZodType, def: Def): unknown {
  switch (def.type) {
    case 'lazy':
      return innerOfOneLazy(schema as core.$ZodLazy);
    case 'readonly':
      return def.innerType;
    case 'pipe':
      return def.in;
    default:
      return undefined;
  }
}

/**
 * The values zod reads from a variant at a key, as its `propValues` does: a literal's or an
 * enum's, and for a discriminated union standing in a variant's place those of its variants.
 */
function valuesOf(option: unknown, key: string): ReadonlySet<unknown> | undefined {
  const variant = forwardedDefOf(option, variantForwarding);
  if (variant === undefined) {
    return undefined;
  }
  if (variant.type === 'object') {
    return valuesOfField(fieldOf(variant, key));
  }
  return isTaggedDef(variant) ? valuesOfTagged(variant, key) : undefined;
}

function valuesOfField(field: unknown): ReadonlySet<unknown> | undefined {
  const discriminator = forwardedDefOf(field, fieldForwarding);
  switch (discriminator?.type) {
    case 'literal':
      return new Set(discriminator.values);
    case 'enum':
      return new Set(core.util.getEnumValues(discriminator.entries));
    default:
      return undefined;
  }
}

/** The values at a key of every variant of a discriminated union, the unions inside it included. */
function valuesOfTagged(union: DefOfType<'union'>, key: string): ReadonlySet<unknown> {
  const values = new Set<unknown>();
  const met = new Set<unknown>([union]);
  const pending: unknown[] = [...union.options];
  while (pending.length > 0) {
    const variant = forwardedDefOf(pending.pop(), variantForwarding);
    if (variant?.type === 'object') {
      for (const value of valuesOfField(fieldOf(variant, key)) ?? []) {
        values.add(value);
      }
    } else if (variant !== undefined && isTaggedDef(variant) && !met.has(variant)) {
      met.add(variant);
      pending.push(...variant.options);
    }
  }
  return values;
}
