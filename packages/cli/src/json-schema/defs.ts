import { type Defs, reachedDefsOf, type SchemaNode } from '@cf-loom/contract/internal';
import { type DefUse, defNamesLineOf, defTypeNameOf } from '../schema-code/index.ts';
import { jsonSchemaOf } from './json-schema.ts';
import type { JsonSchema } from './keywords.ts';

/** The components of the recursive defs some nodes reach, by their names, or why an id has none. */
export type DefComponents =
  | { readonly kind: 'named'; readonly schemas: Readonly<Record<string, JsonSchema>> }
  | { readonly kind: 'unnamed'; readonly line: string };

/**
 * The components of the recursive defs the nodes reach, each written once under the name of its
 * type in code, so a name never meets a code or an Envelope.
 */
export function defComponentsOf(nodes: readonly SchemaNode[], defs: Defs): DefComponents {
  const ids = reachedDefsOf(nodes, defs);
  const uses = ids.map((id): DefUse => ({ id, mode: 'declared' }));
  const line = defNamesLineOf(uses);
  if (line !== undefined) {
    return { kind: 'unnamed', line };
  }
  return { kind: 'named', schemas: Object.fromEntries(ids.map((id) => componentOf(id, defs))) };
}

function componentOf(id: string, defs: Defs): readonly [string, JsonSchema] {
  const def = defs[id];
  if (def === undefined) {
    throw new Error(`The schemas reference the def ${id}, which the defs given lack`);
  }
  return [defTypeNameOf(id, 'declared'), jsonSchemaOf(def)];
}
