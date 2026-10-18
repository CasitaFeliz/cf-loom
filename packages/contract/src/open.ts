import { z } from 'zod';
import type * as core from 'zod/v4/core';

const openSchemas = new WeakSet<core.$ZodType>();

type Variant<Discriminator extends string> = core.$ZodObject<{
  readonly [Key in Discriminator]: core.$ZodLiteral<string>;
}>;

/** Declares an enum whose readers handle values they do not know, so values can be added later. */
export function openEnum<const Values extends readonly [string, ...string[]]>(values: Values) {
  const schema = z.enum(values);
  openSchemas.add(schema);
  return schema;
}

/** Declares a discriminated union whose readers handle unknown variants, so more can be added. */
export function openUnion<
  const Discriminator extends string,
  const Variants extends readonly [Variant<Discriminator>, ...Variant<Discriminator>[]],
>(discriminator: Discriminator, variants: Variants) {
  const schema = z.discriminatedUnion(discriminator, variants);
  openSchemas.add(schema);
  return schema;
}

/** Whether a schema was declared open, by identity: a clone is a new schema and is closed. */
export function isOpen(schema: core.$ZodType): boolean {
  return openSchemas.has(schema);
}
