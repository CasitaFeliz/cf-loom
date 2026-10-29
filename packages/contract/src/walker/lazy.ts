import type * as core from 'zod/v4/core';
import { defOf, isSchema } from './def-types.ts';

/**
 * What one `z.lazy()` stands for, a schema of its own unless its function returned another
 * value. The walk takes one level at a time, so an id or annotations on any lazy of a chain are
 * read.
 */
export function innerOfOneLazy(schema: core.$ZodLazy): unknown {
  return schema._zod.innerType;
}

/**
 * What a `z.lazy()` stands for, through any number of them, for looking up a shape only: it skips
 * the ids and annotations of the lazies on the way, and stops at a lazy the chain meets again,
 * which stands for no schema, and at a value that is no zod 4 schema.
 */
export function innerOfLazy(value: unknown): unknown {
  const met = new Set<unknown>();
  let current = value;
  while (isSchema(current) && defOf(current).type === 'lazy' && !met.has(current)) {
    met.add(current);
    current = innerOfOneLazy(current as core.$ZodLazy);
  }
  return current;
}
