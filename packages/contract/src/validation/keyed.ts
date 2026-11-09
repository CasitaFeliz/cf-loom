import { z } from 'zod';

/**
 * A map read with zod of which every key survives: zod's record drops a `__proto__` key without a
 * word, so one is refused first, with `reason`.
 */
export function everyKeyRecordOf<Value extends z.core.$ZodType>(value: Value, reason: string) {
  const withoutProtoKey = z.unknown().superRefine((input, ctx) => {
    if (typeof input === 'object' && input !== null && Object.hasOwn(input, '__proto__')) {
      ctx.addIssue({ code: 'custom', message: reason, path: ['__proto__'] });
    }
  });
  return z.pipe(withoutProtoKey, z.record(z.string(), value));
}
