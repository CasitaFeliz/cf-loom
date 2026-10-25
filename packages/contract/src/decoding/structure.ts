import { z } from 'zod';
import type { PublishedSnapshot } from '../snapshot/index.ts';
import { publishedCommand, publishedEndpoint, publishedEvent } from './elements.ts';
import { byKey } from './maps.ts';
import { objectNode, schemaNode } from './nodes.ts';
import { semanticVersionText } from './texts.ts';

const text = z.string();
const heading = {
  format: z.literal(1),
  name: text,
  version: semanticVersionText,
  generator: text,
};

const guard = z.strictObject({
  origin: text,
  description: text,
  guards: z.array(text),
  qualifier: schemaNode.nullable(),
  demands: z.strictObject({ headers: objectNode.nullable(), query: objectNode.nullable() }),
  context: schemaNode.nullable(),
  rejections: z.array(text),
});

const code = z.strictObject({
  origin: text,
  status: z.number(),
  message: text,
  body: schemaNode.nullable(),
  removed: z.boolean(),
});

const subscription = z.union([
  z.strictObject({ group: text, description: text, event: text }),
  z.strictObject({ event: text, removedIn: semanticVersionText }),
]);

const dependencies = byKey(
  z.strictObject({
    against: text,
    endpoints: z.array(z.strictObject({ id: text, name: text })),
  }),
);

const standardRejections = z.strictObject({
  invalidInput: text,
  notFound: text,
  notImplemented: text,
});

const service = z.strictObject({
  ...heading,
  kind: z.literal('service'),
  definitions: byKey(text),
  standardRejections,
  defs: byKey(schemaNode),
  endpoints: byKey(publishedEndpoint),
  events: byKey(publishedEvent),
  commands: byKey(publishedCommand),
  guards: byKey(guard),
  codes: byKey(code),
  subscriptions: byKey(subscription),
  dependencies,
});

const application = z.strictObject({ ...heading, kind: z.literal('application'), dependencies });

const definitions = z.strictObject({
  ...heading,
  kind: z.literal('definitions'),
  standardRejections,
  defs: byKey(schemaNode),
  schemas: byKey(schemaNode),
  guards: byKey(guard),
  codes: byKey(code),
});

/** Format 1's structure of a published Snapshot by its kind: every key and value is closed. */
export const publishedSnapshot: z.ZodType<PublishedSnapshot> = z.discriminatedUnion('kind', [
  service,
  application,
  definitions,
]);
