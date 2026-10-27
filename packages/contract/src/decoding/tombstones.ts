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
 * An entry read as the form that holds a key when it holds it and as the other when it does not,
 * as received, so a failure names the key that breaks it.
 */
function readByKey<Held extends z.core.$ZodType, Unheld extends z.core.$ZodType>(
  key: string,
  held: Held,
  unheld: Unheld,
) {
  return z.unknown().transform((entry, ctx) => {
    const holdsKey = typeof entry === 'object' && entry !== null && Object.hasOwn(entry, key);
    const read = readWith(holdsKey ? held : unheld, entry, formatDefiner);
    return read.kind === 'read' ? read.value : refusedAs(read.problems, entry, ctx);
  });
}

/** A published entry keeps its Group while it is declared and loses it as a tombstone. */
export function declaredOrTombstone<
  Declared extends z.core.$ZodType,
  Tombstone extends z.core.$ZodType,
>(declared: Declared, tombstone: Tombstone) {
  return readByKey('group', declared, tombstone);
}

/** A published code holds `removedIn` once no Endpoint answers it, and then the defs it reached. */
export function declaredOrRemoved<
  Declared extends z.core.$ZodType,
  Removed extends z.core.$ZodType,
>(declared: Declared, removed: Removed) {
  return readByKey('removedIn', removed, declared);
}
