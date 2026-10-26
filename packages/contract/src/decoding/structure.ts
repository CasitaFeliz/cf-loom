import { z } from 'zod';
import type { PublishedSnapshot } from '../snapshot/index.ts';
import { byCodePoint } from '../walker/index.ts';
import { publishedCommand, publishedEndpoint, publishedEvent } from './elements.ts';
import { byKey, inCanonicalOrder } from './maps.ts';
import { objectNode, schemaNode } from './nodes.ts';
import { semanticVersionText } from './texts.ts';
import { declaredOrTombstone } from './tombstones.ts';

const text = z.string();
const codeList = inCanonicalOrder(text, byCodePoint);
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
  demands: z.strictObject({ headers: objectNode, query: objectNode }),
  context: schemaNode.nullable(),
  rejections: codeList,
});

/** A def is never nullable: `.nullable()` belongs to a use of it, so every `ref` to it carries it. */
const def = schemaNode.refine((node) => node.nullable !== true, {
  message: 'is nullable: a def is written plain, and each ref to it carries nullable',
});

const code = z.strictObject({
  origin: text,
  status: z.number(),
  message: text,
  body: schemaNode.nullable(),
  removedIn: semanticVersionText.exactOptional(),
});

const subscription = declaredOrTombstone(
  z.strictObject({ group: text, description: text, event: text }),
  z.strictObject({ event: text, removedIn: semanticVersionText }),
);

const dependencies = byKey(
  z.strictObject({
    against: semanticVersionText,
    endpoints: inCanonicalOrder(z.strictObject({ id: text, name: text }), (left, right) =>
      byCodePoint(left.id, right.id),
    ),
  }),
);

const standardRejections = z.strictObject({
  invalidInput: text,
  notFound: text,
  notImplemented: text,
});

const group = z.strictObject({ description: text });

const service = z.strictObject({
  ...heading,
  kind: z.literal('service'),
  standardRejections,
  groups: byKey(group),
  defs: byKey(def),
  endpoints: byKey(publishedEndpoint),
  events: byKey(publishedEvent),
  commands: byKey(publishedCommand),
  guards: byKey(guard),
  codes: byKey(code),
  subscriptions: byKey(subscription),
  dependencies,
});

const application = z.strictObject({ ...heading, kind: z.literal('application'), dependencies });

const exported = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('guard'), guard: text }),
  z.strictObject({ kind: z.literal('rejection'), code: text }),
  z.strictObject({ kind: z.literal('schema'), schema: schemaNode }),
]);

const definitions = z.strictObject({
  ...heading,
  kind: z.literal('definitions'),
  standardRejections,
  defs: byKey(def),
  exports: byKey(exported),
  guards: byKey(guard),
  codes: byKey(code),
});

/** Format 1's structure of a published Snapshot by its kind: every key and value is closed. */
export const publishedSnapshot: z.ZodType<PublishedSnapshot> = z.discriminatedUnion('kind', [
  service,
  application,
  definitions,
]);
