import type { SchemaNode } from '@casitafeliz/loom-contract/internal';
import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import { headerOf, moduleTextOf, namedImportOf, stringLiteralOf } from '../source-text/index.ts';
import { defIdentifierOf, defTypeNameOf } from './def-names.ts';
import { type Helper, type Needs, noNeeds, type SchemaMode } from './needs.ts';
import { typeTextOf } from './type-text.ts';
import { zodExpressionOf } from './zod-expression.ts';

/** A recursive def in one mode, by its id, with its node. */
type DefUse = { readonly id: string; readonly mode: SchemaMode; readonly node: SchemaNode };

/** The recursive defs of a Snapshot, by id. */
export type Defs = Readonly<Record<string, SchemaNode>>;

/**
 * Two ids of a Snapshot's defs whose identifiers are the same once written as code, which would
 * make two schemas one; none when every identifier is its own.
 */
export function collidingDefIdsOf(defs: Defs): readonly [string, string] | undefined {
  const idByIdentifier = new Map<string, string>();
  for (const id of Object.keys(defs).sort(byCodePoint)) {
    const identifier = defIdentifierOf(id, 'declared');
    const earlier = idByIdentifier.get(identifier);
    if (earlier !== undefined) {
      return [earlier, id];
    }
    idByIdentifier.set(identifier, id);
  }
  return undefined;
}

/**
 * The module of the recursive defs the generated schemas reference, in each mode they are
 * referenced in, with those they reference in turn: each a `z.lazy` annotated with its type, a
 * declared one carrying its id so it walks back to the same `ref`.
 */
export function defsModuleOf(defs: Defs, referenced: ReadonlySet<string>): string {
  const helpers = new Set<Helper>();
  const body: string[] = [];
  for (const use of reachedDefsOf(defs, referenced)) {
    const needs = noNeeds();
    body.push(...defLinesOf(use, needs));
    for (const helper of needs.helpers) {
      helpers.add(helper);
    }
  }
  const contractImport =
    helpers.size === 0
      ? []
      : [namedImportOf([...helpers].sort(byCodePoint), '@casitafeliz/loom-contract')];
  const imports = [...contractImport, namedImportOf(['z'], 'zod')];
  return moduleTextOf({ first: [headerOf('package')], imports, body });
}

/** Every def use the referenced ones reach through their own `ref`s, in identifier order. */
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

function defLinesOf(use: DefUse, needs: Needs): readonly string[] {
  const { node } = use;
  const typeName = defTypeNameOf(use.id, use.mode);
  const identifier = defIdentifierOf(use.id, use.mode);
  const lazy = `z.lazy(() => ${zodExpressionOf(node, { mode: use.mode, needs })})`;
  const schema =
    use.mode === 'declared' ? `${lazy}.meta({ id: ${stringLiteralOf(use.id)} })` : lazy;
  return [
    `export type ${typeName} = ${typeTextOf(node, use.mode)};`,
    `export const ${identifier}: z.ZodType<${typeName}> = ${schema};`,
  ];
}
