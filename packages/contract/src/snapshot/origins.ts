import type { ResolvedDefinitions } from '../validation/index.ts';
import { byCodePoint, type Origin, type OriginOf } from '../walker/index.ts';
import { type LocatedDefinitions, membersOf, type ResolvedStandard } from '../written/index.ts';

/**
 * Where each shared schema of the listed Definitions Packages came from, as the walk writes it on
 * the node: the package and the first name, in code point order, it is exported under; a clone of
 * one is a new schema and has none.
 */
export function schemaOriginsOf(packages: readonly ResolvedDefinitions[]): OriginOf {
  const originBySchema = new Map<unknown, Origin>();
  for (const resolved of packages) {
    const schemas = membersOf(resolved.exports).schemas.toSorted(([left], [right]) =>
      byCodePoint(left, right),
    );
    for (const [name, schema] of schemas) {
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
