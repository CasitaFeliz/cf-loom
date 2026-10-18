import type { SchemaNode } from '@casitafeliz/loom-contract/internal';
import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import { stringLiteralOf } from '../source-text/index.ts';
import { defIdentifierOf, defTypeNameOf } from './def-names.ts';
import { type Needs, noNeeds, type SchemaMode } from './needs.ts';
import { typeTextOf } from './type-text.ts';
import { zodExpressionOf } from './zod-expression.ts';

/** A recursive def in one mode, by its id, with its node. */
type DefUse = { readonly id: string; readonly mode: SchemaMode; readonly node: SchemaNode };

/** The recursive defs of a Snapshot, by id. */
export type Defs = Readonly<Record<string, SchemaNode>>;

/** The declarations of the recursive defs generated schemas reference, and what they import. */
export type DefsCode = { readonly body: readonly string[]; readonly needs: Needs };

/**
 * The recursive defs the generated schemas reference, in each mode they are referenced in, and
 * those they reference in turn, in identifier order.
 */
export function defsCodeOf(defs: Defs, referenced: ReadonlySet<string>): DefsCode {
  const needs = noNeeds();
  const body = reachedDefsOf(defs, referenced).flatMap((use) => defLinesOf(use, needs));
  return { body, needs };
}

function reachedDefsOf(defs: Defs, referenced: ReadonlySet<string>): readonly DefUse[] {
  const uses = allUsesOf(defs);
  const reached = new Map<string, DefUse>();
  const pending = [...referenced];
  for (let identifier = pending.pop(); identifier !== undefined; identifier = pending.pop()) {
    const use = uses.get(identifier);
    if (use === undefined || reached.has(identifier)) {
      continue;
    }
    reached.set(identifier, use);
    const needs = noNeeds();
    zodExpressionOf(use.node, { mode: use.mode, needs });
    pending.push(...needs.defs);
  }
  const identifiers = [...reached.keys()].sort(byCodePoint);
  return identifiers.map((identifier) => reached.get(identifier)).filter(isDefUse);
}

function isDefUse(use: DefUse | undefined): use is DefUse {
  return use !== undefined;
}

function allUsesOf(defs: Defs): ReadonlyMap<string, DefUse> {
  const modes: readonly SchemaMode[] = ['declared', 'reader'];
  const uses = Object.entries(defs).flatMap(([id, node]) =>
    modes.map((mode): [string, DefUse] => [defIdentifierOf(id, mode), { id, mode, node }]),
  );
  return new Map(uses);
}

/**
 * One def as a `z.lazy` annotated with its type, since TypeScript cannot infer a cycle; the
 * declared one carries its id, so it walks back to the same `ref`.
 */
function defLinesOf(use: DefUse, needs: Needs): readonly string[] {
  const { id, mode, node } = use;
  const typeName = defTypeNameOf(id, mode);
  const lazy = `z.lazy(() => ${zodExpressionOf(node, { mode, needs })})`;
  const schema = mode === 'declared' ? `${lazy}.meta({ id: ${stringLiteralOf(id)} })` : lazy;
  return [
    `export type ${typeName} = ${typeTextOf(node, mode)};`,
    `export const ${defIdentifierOf(id, mode)}: z.ZodType<${typeName}> = ${schema};`,
  ];
}
