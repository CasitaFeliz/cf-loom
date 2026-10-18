import type * as core from 'zod/v4/core';

/** The schema a `z.lazy()` stands for, through any number of them: a lazy is transparent. */
export function innerOfLazy(schema: core.$ZodType): core.$ZodType {
  if (schema._zod.def.type !== 'lazy') {
    return schema;
  }
  return innerOfLazy((schema as core.$ZodLazy)._zod.innerType);
}
