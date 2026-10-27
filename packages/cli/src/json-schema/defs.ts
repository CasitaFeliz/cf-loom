import { type Defs, reachedDefsOf, type SchemaNode } from '@cf-loom/contract/internal';
import { jsonSchemaOf } from './json-schema.ts';
import type { JsonSchema, JsonSchemaDialect } from './keywords.ts';
import { defComponentNameOf } from './refs.ts';

/**
 * The components of the recursive defs the nodes reach, in a dialect, each written once under the
 * name of its type in code, so a name never meets a code or an Envelope.
 */
export function defComponentsOf(
  nodes: readonly SchemaNode[],
  defs: Defs,
  dialect: JsonSchemaDialect,
): Readonly<Record<string, JsonSchema>> {
  const ids = reachedDefsOf(nodes, defs);
  return Object.fromEntries(ids.map((id) => componentOf(id, defs, dialect)));
}

function componentOf(
  id: string,
  defs: Defs,
  dialect: JsonSchemaDialect,
): readonly [string, JsonSchema] {
  const def = defs[id];
  if (def === undefined) {
    throw new Error(`The schemas reference the def ${id}, which the defs given lack`);
  }
  return [defComponentNameOf(id), jsonSchemaOf(def, dialect)];
}
