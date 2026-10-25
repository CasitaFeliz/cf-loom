import type { ExportSnapshot, SchemaNode } from '../src/internal/index.ts';

/** A Definitions Package's exports that are shared schemas, each by the name it is exported under. */
export function schemaExports(
  schemas: Readonly<Record<string, SchemaNode>>,
): Readonly<Record<string, ExportSnapshot>> {
  const entries = Object.entries(schemas).map(([name, schema]) => [
    name,
    { kind: 'schema', schema },
  ]);
  return Object.fromEntries(entries);
}
