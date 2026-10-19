import { z } from 'zod';
import type * as core from 'zod/v4/core';

const openKey = Symbol.for('@casitafeliz/loom-contract.open');

/** Kept on `globalThis`, so a schema made open by one copy of this package is open to every copy. */
const openHolder = globalThis as typeof globalThis & { [openKey]?: WeakSet<core.$ZodType> };
openHolder[openKey] ??= new WeakSet<core.$ZodType>();
const openSchemas = openHolder[openKey];

/** Declares an enum whose readers handle values they do not know, so values can be added later. */
export function openEnum<const Values extends readonly [string, ...string[]]>(values: Values) {
  const schema = z.enum(values);
  openSchemas.add(schema);
  return schema;
}

/**
 * Whether a schema was declared open: by `openEnum()` itself, or cloned from one by zod's own
 * `.describe()`, `.meta()` or `.check()`, which keep the shape.
 */
export function isOpen(schema: core.$ZodType): boolean {
  const parent = schema._zod.parent;
  return openSchemas.has(schema) || (parent !== undefined && isOpen(parent));
}
