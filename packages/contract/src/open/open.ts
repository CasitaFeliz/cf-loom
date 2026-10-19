import { z } from 'zod';
import type * as core from 'zod/v4/core';

const openKey = Symbol.for('@casitafeliz/loom-contract.open');

/** Kept on `globalThis`, so a schema made open by one copy of this package is open to every copy. */
const openHolder = globalThis as typeof globalThis & { [openKey]?: WeakSet<core.$ZodType> };
openHolder[openKey] ??= new WeakSet<core.$ZodType>();
const openSchemas = openHolder[openKey];

/**
 * A variant as zod's discriminated union takes it, an object or a `z.lazy` of one, whose output
 * holds the discriminator as a string.
 */
type Variant<Discriminator extends string> = core.$ZodTypeDiscriminable & {
  readonly _zod: { readonly output: { readonly [Key in Discriminator]: string } };
};

/** Each variant as given when its discriminator is a string literal, `never` when it is `string`. */
type LiteralDiscriminators<
  Variants extends readonly Variant<Discriminator>[],
  Discriminator extends string,
> = {
  readonly [Index in keyof Variants]: string extends Variants[Index]['_zod']['output'][Discriminator]
    ? never
    : Variants[Index];
};

/** Declares an enum whose readers handle values they do not know, so values can be added later. */
export function openEnum<const Values extends readonly [string, ...string[]]>(values: Values) {
  const schema = z.enum(values);
  openSchemas.add(schema);
  return schema;
}

/**
 * Declares a discriminated union whose readers handle unknown variants, so more can be added.
 * Its types refuse a variant without a string-literal discriminator; what zod's own union also
 * takes, an enum or several-literal discriminator, a nested union or intersection variant or a
 * `.default()`, only `generate` refuses.
 */
export function openUnion<
  const Discriminator extends string,
  const Variants extends readonly [Variant<Discriminator>, ...Variant<Discriminator>[]],
>(
  discriminator: Discriminator,
  variants: Variants & LiteralDiscriminators<Variants, Discriminator>,
) {
  const schema = z.discriminatedUnion(discriminator, variants);
  openSchemas.add(schema);
  return schema;
}

/**
 * Whether a schema was declared open: by `openEnum()` or `openUnion()` itself, or cloned from
 * one by zod's own `.describe()`, `.meta()` or `.check()`, which keep the shape.
 */
export function isOpen(schema: core.$ZodType): boolean {
  const parent = schema._zod.parent;
  return openSchemas.has(schema) || (parent !== undefined && isOpen(parent));
}
