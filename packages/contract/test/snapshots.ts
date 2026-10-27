import type { ExportSnapshot, PublishedHeading, SchemaNode } from '../src/internal/index.ts';

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

/** The CLI the tests' published Snapshots name as the one that wrote them. */
export const publishedBy = '@cf-loom/cli@2.1.0';

/** What a publish adds to a declared Snapshot's heading, at a version, by the CLI the tests name. */
export function publishedAt(version: string): PublishedHeading {
  return { version, generator: publishedBy };
}

/** What a first publish adds to a declared Service Snapshot: its heading, and no former Input yet. */
export function publishedServiceAt(version: string): PublishedHeading & {
  readonly formerInputs: readonly [];
} {
  return { ...publishedAt(version), formerInputs: [] };
}
