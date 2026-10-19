import type { SchemaNode } from '@casitafeliz/loom-contract/internal';
import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import { stringLiteralOf } from '../source-text/index.ts';
import { defIdentifierOf, defTypeNameOf } from './def-names.ts';
import { type DefUse, defUseKeyOf, type Needs, noNeeds } from './needs.ts';
import { typeTextOf } from './type-text.ts';
import { zodExpressionOf } from './zod-expression.ts';

/** The recursive defs of a Snapshot, by id. */
export type Defs = Readonly<Record<string, SchemaNode>>;

/** The declarations of the recursive defs generated schemas reach, and what they import. */
export type DefsCode = { readonly body: readonly string[]; readonly needs: Needs };

/**
 * The def uses the referenced ones reach through their own `ref`s, the referenced included,
 * each once, in code point order of its identifier.
 */
export function reachedDefUsesOf(defs: Defs, referenced: readonly DefUse[]): readonly DefUse[] {
  const reached = new Map<string, DefUse>();
  const pending = [...referenced];
  for (let use = pending.pop(); use !== undefined; use = pending.pop()) {
    const node = defs[use.id];
    const key = defUseKeyOf(use);
    if (node === undefined || reached.has(key)) {
      continue;
    }
    reached.set(key, use);
    const needs = noNeeds();
    zodExpressionOf(node, { mode: use.mode, needs });
    pending.push(...needs.defs.values());
  }
  return [...reached.values()].sort((left, right) =>
    byCodePoint(defIdentifierOf(left.id, left.mode), defIdentifierOf(right.id, right.mode)),
  );
}

/** The declarations of the def uses given, with what they import but each other. */
export function defsCodeOf(defs: Defs, uses: readonly DefUse[]): DefsCode {
  const needs = noNeeds();
  const body = uses.flatMap((use) => defLinesOf(use, defs, needs));
  return { body, needs };
}

/**
 * One def as a `z.lazy` annotated with its type, since TypeScript cannot infer a cycle; the
 * declared one carries its id, so it walks back to the same `ref`.
 */
function defLinesOf(use: DefUse, defs: Defs, needs: Needs): readonly string[] {
  const { id, mode } = use;
  const node = defs[id];
  if (node === undefined) {
    return [];
  }
  const own = noNeeds();
  const typeName = defTypeNameOf(id, mode);
  const lazy = `z.lazy(() => ${zodExpressionOf(node, { mode, needs: own })})`;
  const schema = mode === 'declared' ? `${lazy}.meta({ id: ${stringLiteralOf(id)} })` : lazy;
  const lines = [
    `export type ${typeName} = ${typeTextOf(node, mode, own)};`,
    `export const ${defIdentifierOf(id, mode)}: z.ZodType<${typeName}> = ${schema};`,
  ];
  for (const module of own.modules) {
    needs.modules.add(module);
  }
  return lines;
}
