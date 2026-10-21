import { z } from 'zod';

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
