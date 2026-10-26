import { byCodePoint, type Defs, reachedDefsOf, type SchemaNode } from '@cf-loom/contract/internal';
import { stringLiteralOf } from '../source-text/index.ts';
import { defIdentifierOf, defTypeNameOf } from './def-names.ts';
import {
  addModulesOf,
  type DefUse,
  type Needs,
  noNeeds,
  type SchemaMode,
  schemaModes,
} from './needs.ts';
import { typeTextOf } from './type-text.ts';
import { zodExpressionOf } from './zod-expression.ts';

/** The declarations of the recursive defs generated schemas reach, and what they import. */
export type DefsCode = { readonly body: readonly string[]; readonly needs: Needs };

/**
 * The def uses the referenced ones reach through their own `ref`s, the referenced included,
 * each once per mode, in code point order of its identifier.
 */
export function reachedDefUsesOf(defs: Defs, referenced: readonly DefUse[]): readonly DefUse[] {
  const uses = schemaModes.flatMap((mode) => {
    const refs = referenced
      .filter((use) => use.mode === mode)
      .map(({ id }): SchemaNode => ({ type: 'ref', name: id }));
    return reachedDefsOf(refs, defs).map((id): DefUse => ({ id, mode }));
  });
  return uses.sort((left, right) =>
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
    throw new Error(`The generated code references the def ${id}, which the defs given lack`);
  }
  const own = noNeeds();
  const typeName = defTypeNameOf(id, mode);
  const lazy = `z.lazy(() => ${zodExpressionOf(node, { mode, needs: own })})`;
  const schema = mode === 'declared' ? `${lazy}.meta({ id: ${stringLiteralOf(id)} })` : lazy;
  const lines = [
    `export type ${typeName} = ${typeTextOf(node, mode, own)};`,
    `export const ${defIdentifierOf(id, mode)}: ${annotationOf(node, { typeName, mode })} = ${schema};`,
  ];
  addModulesOf(needs, own);
  return lines;
}

/** A def's type name, and the mode it is written in. */
type DefNames = { readonly typeName: string; readonly mode: SchemaMode };

/**
 * A def's annotation, so a written type that disagrees with the schema fails to compile: its
 * output type, its input type too as declared, and for an object, that it is a variant zod's
 * discriminated union takes.
 */
function annotationOf(node: SchemaNode, { typeName, mode }: DefNames): string {
  const output =
    mode === 'declared' ? `z.ZodType<${typeName}, ${typeName}>` : `z.ZodType<${typeName}>`;
  const isObject = node.type === 'object';
  return isObject ? `${output} & z.core.$ZodTypeDiscriminable` : output;
}
