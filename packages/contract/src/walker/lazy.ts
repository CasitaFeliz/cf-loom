import type * as core from 'zod/v4/core';
import { isSchema } from './def-types.ts';

/**
 * The schema one `z.lazy()` stands for. The walk takes one level at a time, each a schema of its
 * own, so an id or annotations on any lazy of a chain are read.
 */
export function innerOfOneLazy(schema: core.$ZodLazy): core.$ZodType {
  return schema._zod.innerType;
}

/**
 * The schema a `z.lazy()` stands for, through any number of them, for looking up a shape only:
 * it skips the ids and annotations of the lazies on the way, and stops at a lazy the chain meets
 * again, which stands for no schema, and at a value that is no zod 4 schema.
 */
export function innerOfLazy(schema: core.$ZodType): core.$ZodType {
  const met = new Set<core.$ZodType>();
  let current = schema;
  while (isSchema(current) && current._zod.def.type === 'lazy' && !met.has(current)) {
    met.add(current);
    current = innerOfOneLazy(current as core.$ZodLazy);
  }
  return current;
}
