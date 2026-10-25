import { z } from 'zod';
import type * as core from 'zod/v4/core';

const openKey = Symbol.for('@cf-loom/contract.open');

type OpenMarked = { [openKey]?: true };

declare const openEnumBrand: unique symbol;

/**
 * An enum whose readers handle values they do not know; what it derives with `exclude` or
 * `extract` stays open. A `z.enum()` is not one.
 */
export interface OpenEnum<T extends core.util.EnumLike> extends z.ZodEnum<T> {
  readonly [openEnumBrand]: true;
  extract<const Keys extends readonly (keyof T)[]>(
    values: Keys,
    params?: string | core.$ZodEnumParams,
  ): OpenEnum<core.util.Flatten<Pick<T, Keys[number]>>>;
  exclude<const Keys extends readonly (keyof T)[]>(
    values: Keys,
    params?: string | core.$ZodEnumParams,
  ): OpenEnum<core.util.Flatten<Omit<T, Keys[number]>>>;
}

/** Declares an enum whose readers handle values they do not know, so values can be added later. */
export function openEnum<const Values extends readonly [string, ...string[]]>(
  values: Values,
): OpenEnum<core.util.ToEnum<Values[number]>> {
  const schema = z.enum(values);
  (schema._zod.def as OpenMarked)[openKey] = true;
  return schema as unknown as OpenEnum<core.util.ToEnum<Values[number]>>;
}

/**
 * Whether a schema was declared open: `openEnum()` marks its definition, which zod copies into
 * every schema it derives.
 */
export function isOpen(schema: core.$ZodType): boolean {
  return (schema._zod.def as OpenMarked)[openKey] === true;
}

/** What an Unknown case may never hold: a value its Open Enum declares, which reads as itself. */
const declaredMessage = 'A declared value, not an Unknown case';

/**
 * An Open Enum's Reader schema, which generated readers call: a declared value reads as itself and
 * any other string as its Unknown case, `{ unknown }`, which is written back as that string.
 */
export function openEnumReader<const Values extends readonly [string, ...string[]]>(
  values: Values,
) {
  const declared: ReadonlySet<string> = new Set(values);
  const undeclared = z.string().refine((text) => !declared.has(text), declaredMessage);
  const unknownCase = z.codec(undeclared, z.object({ unknown: z.string() }), {
    decode: (unknown) => ({ unknown }),
    encode: ({ unknown }) => unknown,
  });
  return z.union([z.enum(values), unknownCase]);
}
