import { z } from 'zod';
import { type Problem, readWith } from '../validation/index.ts';
import { formatDefiner } from './texts.ts';

/** Hands the problems of a refused read to the schema that asked for it, at the places they have. */
function refusedAs(problems: readonly Problem[], entry: unknown, ctx: z.core.$RefinementCtx) {
  for (const problem of problems) {
    ctx.issues.push({
      code: 'custom',
      message: problem.reason,
      path: [...problem.at],
      input: entry,
    });
  }
  return z.NEVER;
}

/**
 * A published entry keeps its Group while it is declared and loses it as a tombstone, so its Group
 * says which of the two it is read as, as received, and a failure names the key that breaks it.
 */
export function declaredOrTombstone<
  Declared extends z.core.$ZodType,
  Tombstone extends z.core.$ZodType,
>(declared: Declared, tombstone: Tombstone) {
  return z.unknown().transform((entry, ctx) => {
    const keepsGroup = typeof entry === 'object' && entry !== null && Object.hasOwn(entry, 'group');
    const read = readWith(keepsGroup ? declared : tombstone, entry, formatDefiner);
    return read.kind === 'read' ? read.value : refusedAs(read.problems, entry, ctx);
  });
}
