import { z } from 'zod';
import { readEndpointIdentity } from '../written/index.ts';
import { notEndpointIdentity } from './texts.ts';

/** Zod's record drops a `__proto__` key without a word, so a Snapshot that holds one is refused first. */
const withoutProtoKey = z.unknown().superRefine((input, ctx) => {
  if (typeof input === 'object' && input !== null && Object.hasOwn(input, '__proto__')) {
    ctx.addIssue({
      code: 'custom',
      message: 'is a key no map of a Snapshot holds',
      path: ['__proto__'],
    });
  }
});

/** A map of a Snapshot by key, of which every key survives being read. */
export function byKey<Value extends z.core.$ZodType>(value: Value) {
  return z.pipe(withoutProtoKey, z.record(z.string(), value));
}

/** A map of a Snapshot by Endpoint identity: a key that is none is refused where it stands. */
export function byEndpointIdentity<Value extends z.core.$ZodType>(value: Value) {
  return byKey(value).superRefine((entries, ctx) => {
    for (const key of Object.keys(entries)) {
      if (readEndpointIdentity(key) === undefined) {
        ctx.addIssue({ code: 'custom', message: notEndpointIdentity, path: [key] });
      }
    }
  });
}

/**
 * A list in canonical order, each item once: every item strictly after the one before by
 * `compare`, the order `generate` writes an array whose order means nothing in.
 */
export function inCanonicalOrder<Item extends z.ZodType>(
  item: Item,
  compare: (left: z.output<Item>, right: z.output<Item>) => number,
) {
  return z.array(item).superRefine((items, ctx) => {
    const unordered = items.some((current, index) => {
      const previous = items[index - 1];
      return previous !== undefined && compare(previous, current) >= 0;
    });
    if (unordered) {
      ctx.addIssue({ code: 'custom', message: 'is not in canonical order, each item once' });
    }
  });
}
