import type * as core from 'zod/v4/core';

/**
 * The schema one `z.lazy()` stands for. The walk takes one level at a time, each a schema of its
 * own, so an id or annotations on any lazy of a chain are read.
 */
export function innerOfOneLazy(schema: core.$ZodLazy): core.$ZodType {
  return schema._zod.innerType;
}

/**
 * The schema a `z.lazy()` stands for, through any number of them, for looking up a shape only:
 * it skips the ids and annotations of the lazies on the way.
 */
export function innerOfLazy(schema: core.$ZodType): core.$ZodType {
  if (schema._zod.def.type !== 'lazy') {
    return schema;
  }
  return innerOfLazy(innerOfOneLazy(schema as core.$ZodLazy));
}
