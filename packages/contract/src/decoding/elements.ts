import { z } from 'zod';
import { successStatuses, visibilities } from '../declarations/index.ts';
import type {
  EndpointSnapshot,
  PublishedCommand,
  PublishedEndpoint,
  PublishedEvent,
} from '../snapshot/index.ts';
import { byCodePoint } from '../walker/index.ts';
import { inCanonicalOrder } from './maps.ts';
import { objectNode, schemaNode } from './nodes.ts';
import { instantText, semanticVersionText } from './texts.ts';
import { declaredOrTombstone } from './tombstones.ts';

const retired = { lifecycle: z.literal('retired'), retiredIn: semanticVersionText };

/** The forms of an Element a Contract Package exports: Active, or Deprecated with what only Deprecation declares. */
function live<Fields extends z.core.$ZodShape, Deprecation extends z.core.$ZodShape>(
  fields: Fields,
  deprecation: Deprecation,
) {
  return [
    z.strictObject({ ...fields, lifecycle: z.literal('active') }),
    z.strictObject({ ...fields, ...deprecation, lifecycle: z.literal('deprecated') }),
  ] as const;
}

/**
 * A published Element: still declared with its lifecycle, a Deprecated one also with what only
 * Deprecation declares, a Retired one with the version that first published it so, or its tombstone,
 * which keeps no Group.
 */
function published<
  Fields extends z.core.$ZodShape,
  Deprecation extends z.core.$ZodShape,
  Tombstone extends z.core.$ZodType,
>(fields: Fields, deprecation: Deprecation, tombstone: Tombstone) {
  const declared = z.discriminatedUnion('lifecycle', [
    ...live(fields, deprecation),
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

const endpointFields = {
  name: z.string(),
  group: z.string(),
  visibility: z.enum(visibilities),
  description: z.string(),
  params: z.array(z.string()),
  guards: z.array(attachment),
  input,
  success,
  rejections: inCanonicalOrder(z.string(), byCodePoint),
};
const endpointDeprecation = { deprecatedAt: instantText.exactOptional() };

/** Format 1's Endpoint in a published Snapshot: declared, or its tombstone with its name. */
export const publishedEndpoint: z.ZodType<PublishedEndpoint> = published(
  endpointFields,
  endpointDeprecation,
  z.strictObject({ ...retired, name: z.string() }),
);

/** Format 1's Endpoint in an exported Snapshot: declared, Active or Deprecated, since a package exports none Retired. */
export const exportedEndpoint: z.ZodType<EndpointSnapshot> = z.discriminatedUnion(
  'lifecycle',
  live(endpointFields, endpointDeprecation),
);

const eventFields = {
  group: z.string(),
  visibility: z.enum(visibilities),
  description: z.string(),
  body: schemaNode,
};

/** Format 1's Event Message Version in a published Snapshot: declared, or its tombstone. */
export const publishedEvent: z.ZodType<PublishedEvent> = published(
  eventFields,
  {},
  messageTombstone,
);

/** Format 1's Command Message Version in a published Snapshot: declared, or its tombstone. */
export const publishedCommand: z.ZodType<PublishedCommand> = published(
  { group: z.string(), description: z.string(), body: schemaNode },
  {},
  messageTombstone,
);
