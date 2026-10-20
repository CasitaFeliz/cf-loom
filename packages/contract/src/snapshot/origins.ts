import type { Origin, OriginOf } from '../walker/index.ts';
import type { LocatedDefinitions, ResolvedStandard } from '../written/index.ts';
import type { ResolvedDefinitions } from './context.ts';

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

/**
 * Where a Guard or a code came from: the listed Definitions Package that lists it, at the version
 * installed, else the root's own.
 */
export function listedOriginOf(
  listedIn: LocatedDefinitions | undefined,
  packages: readonly ResolvedDefinitions[],
): Origin {
  const resolved = packages.find(({ definitions }) => definitions === listedIn?.definitions);
  return resolved === undefined ? 'local' : packageOriginOf(resolved);
}

/** cf-loom's defaults are `standard`; a declared one comes from the package declaring it. */
export function standardOriginOf(
  { declared }: ResolvedStandard,
  packages: readonly ResolvedDefinitions[],
): Origin {
  return declared === undefined ? 'standard' : listedOriginOf(declared.listedIn, packages);
}

function packageOriginOf({ packageName, version }: ResolvedDefinitions): Origin {
  return `${packageName}@${version}`;
}
