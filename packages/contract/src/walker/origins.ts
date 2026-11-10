import type * as core from 'zod/v4/core';
import { type Metadata, metadataOf } from './metadata.ts';
import type { Origin } from './nodes.ts';
import { type Reached, type Under, type Walked, walked } from './walked.ts';

/** The place a schema is entered at: the place given, the schema and its origin, else the nearest one around. */
export function withOrigin(schema: unknown, at: Under, own: Origin | undefined): Reached {
  return { ...at, schema, origin: own ?? at.origin };
}

/** What the schema itself says of its node: its metadata, and the origin it has itself. */
export function ownMetadata(
  schema: core.$ZodType,
  at: Reached,
  origin: Origin | undefined,
): Walked<Metadata> {
  const metadata = metadataOf(schema, at);
  if (metadata.kind === 'not-allowed' || origin === undefined) {
    return metadata;
  }
  const annotations = { ...metadata.value.annotations, origin };
  return walked({ ...metadata.value, annotations });
}
