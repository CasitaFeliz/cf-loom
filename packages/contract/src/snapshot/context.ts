import type { Definitions } from '../declarations/index.ts';
import type { Part, ResolvedStandard } from '../validation/index.ts';
import type { ObjectNode, Origin, OriginOf, SchemaNode } from '../walker/index.ts';

/**
 * A Definitions Package a Contract lists, as installed where its Snapshot is built: the package
 * it is published as and the exact version resolved, which the Snapshot records.
 */
export type ResolvedDefinitions = {
  readonly definitions: Definitions;
  readonly packageName: string;
  readonly version: string;
};

/**
 * What a declared Snapshot is built with besides the valid root: the CLI that writes it, the
 * Definitions Packages as installed, the committed Snapshot's content, and the clock that stamps
 * `deprecatedAt`, so the same inputs always give the same Snapshot.
 */
export type SnapshotContext = {
  readonly generator: string;
  readonly packages: readonly ResolvedDefinitions[];
  readonly committed: unknown;
  readonly now: number;
};

/** What every entry of a Snapshot reads besides its own declaration. */
export type SnapshotSources = {
  readonly nodeOf: (declaration: unknown, part: Part) => SchemaNode | null;
  readonly standards: readonly ResolvedStandard[];
  readonly packages: readonly ResolvedDefinitions[];
};

/**
 * Where each shared schema of the listed Definitions Packages came from, as the walk writes it on
 * the node; a clone of one is a new schema and has none.
 */
export function schemaOriginsOf(packages: readonly ResolvedDefinitions[]): OriginOf {
  const originBySchema = new Map<unknown, Origin>();
  for (const resolved of packages) {
    for (const [name, schema] of Object.entries(resolved.definitions.schemas ?? {})) {
      if (!originBySchema.has(schema)) {
        originBySchema.set(schema, `${packageOriginOf(resolved)}#${name}`);
      }
    }
  }
  return (schema) => originBySchema.get(schema);
}

/** A declaration's origin: the first listed Definitions Package that lists it, else the root's own. */
export function declaredOriginOf(
  packages: readonly ResolvedDefinitions[],
  lists: (definitions: Definitions) => boolean,
): Origin {
  const listing = packages.find(({ definitions }) => lists(definitions));
  return listing === undefined ? 'local' : packageOriginOf(listing);
}

/** A text part's node in the mode the Snapshot stores it, whatever mode the zod object was written with. */
export function inMode(node: ObjectNode | null, mode: ObjectNode['mode']): ObjectNode | null {
  return node === null ? null : { ...node, mode };
}

/** A text part's node, which the validation guarantees is an object wherever one is declared. */
export function objectOf(node: SchemaNode | null): ObjectNode | null {
  if (node === null || node.type === 'object') {
    return node;
  }
  throw new Error('A valid root declares every text part as an object: a bug.');
}

function packageOriginOf({ packageName, version }: ResolvedDefinitions): Origin {
  return `${packageName}@${version}`;
}
