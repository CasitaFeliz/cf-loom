import { z } from 'zod';
import { lifecycles, visibilities } from '../declarations/index.ts';
import type { PublishedCommand, PublishedEndpoint, PublishedEvent } from '../snapshot/index.ts';
import { objectNode, schemaNode } from './nodes.ts';
import { semanticVersionText, stampText } from './texts.ts';

const retired = { lifecycle: z.literal('retired'), retiredIn: semanticVersionText };

/**
 * A published Element: still declared with its lifecycle, a Retired one also with the version that
 * first published it so, or its tombstone.
 */
function published<Fields extends z.core.$ZodShape, Tombstone extends z.core.$ZodType>(
  fields: Fields,
  tombstone: Tombstone,
) {
  return z.union([
    z.strictObject({ ...fields, lifecycle: z.enum(lifecycles).exclude(['retired']) }),
    z.strictObject({ ...fields, ...retired }),
    tombstone,
  ]);
}

const messageTombstone = z.strictObject(retired);
const attachment = z.strictObject({ guard: z.string(), qualifier: z.unknown() });
const input = z.strictObject({
  params: objectNode.nullable(),
  query: objectNode.nullable(),
  headers: objectNode.nullable(),
  body: schemaNode.nullable(),
});
const success = z.strictObject({
  status: z.number(),
  headers: objectNode.nullable(),
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
    rejections: z.array(z.string()),
    deprecatedAt: stampText.exactOptional(),
  },
  z.strictObject({ ...retired, name: z.string() }),
);

/** Format 1's Event Message Version in a published Snapshot: declared, or its tombstone. */
export const publishedEvent: z.ZodType<PublishedEvent> = published(
  { visibility: z.enum(visibilities), description: z.string(), body: schemaNode },
  messageTombstone,
);

/** Format 1's Command Message Version in a published Snapshot: declared, or its tombstone. */
export const publishedCommand: z.ZodType<PublishedCommand> = published(
  { description: z.string(), body: schemaNode },
  messageTombstone,
);
