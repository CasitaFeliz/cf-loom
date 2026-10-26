import { z } from 'zod';
import { successStatuses, visibilities } from '../declarations/index.ts';
import type { PublishedCommand, PublishedEndpoint, PublishedEvent } from '../snapshot/index.ts';
import { byCodePoint } from '../walker/index.ts';
import { inCanonicalOrder } from './maps.ts';
import { objectNode, schemaNode } from './nodes.ts';
import { semanticVersionText, stampText } from './texts.ts';
import { declaredOrTombstone } from './tombstones.ts';

const retired = { lifecycle: z.literal('retired'), retiredIn: semanticVersionText };

/**
 * A published Element: still declared with its lifecycle, a Deprecated one also with what only
 * Deprecation stamps, a Retired one with the version that first published it so, or its tombstone,
 * which keeps no Group.
 */
function published<
  Fields extends z.core.$ZodShape,
  Deprecation extends z.core.$ZodShape,
  Tombstone extends z.core.$ZodType,
>(fields: Fields, deprecation: Deprecation, tombstone: Tombstone) {
  const declared = z.discriminatedUnion('lifecycle', [
    z.strictObject({ ...fields, lifecycle: z.literal('active') }),
    z.strictObject({ ...fields, ...deprecation, lifecycle: z.literal('deprecated') }),
    z.strictObject({ ...fields, ...retired }),
  ]);
  return declaredOrTombstone(declared, tombstone);
}

const messageTombstone = z.strictObject(retired);
const attachment = z.strictObject({ guard: z.string(), qualifier: z.unknown() });
const input = z.strictObject({
  params: objectNode.nullable(),
  query: objectNode,
  headers: objectNode,
  body: schemaNode.nullable(),
});
const success = z.strictObject({
  status: z.literal(successStatuses),
  headers: objectNode,
  body: schemaNode.nullable(),
});

/** Format 1's Endpoint in a published Snapshot: declared, or its tombstone with its name. */
export const publishedEndpoint: z.ZodType<PublishedEndpoint> = published(
  {
    name: z.string(),
    group: z.string(),
    visibility: z.enum(visibilities),
    description: z.string(),
    params: z.array(z.string()),
    guards: z.array(attachment),
    input,
    success,
    rejections: inCanonicalOrder(z.string(), byCodePoint),
  },
  { deprecatedAt: stampText.exactOptional() },
  z.strictObject({ ...retired, name: z.string() }),
);

/** Format 1's Event Message Version in a published Snapshot: declared, or its tombstone. */
export const publishedEvent: z.ZodType<PublishedEvent> = published(
  {
    group: z.string(),
    visibility: z.enum(visibilities),
    description: z.string(),
    body: schemaNode,
  },
  {},
  messageTombstone,
);

/** Format 1's Command Message Version in a published Snapshot: declared, or its tombstone. */
export const publishedCommand: z.ZodType<PublishedCommand> = published(
  { group: z.string(), description: z.string(), body: schemaNode },
  {},
  messageTombstone,
);
