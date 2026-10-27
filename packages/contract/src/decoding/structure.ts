import { z } from 'zod';
import type { FormerInput, PublishedSnapshot } from '../snapshot/index.ts';
import { byCodePoint, canonicalJson } from '../walker/index.ts';
import { publishedCommand, publishedEndpoint, publishedEvent } from './elements.ts';
import { byKey, inCanonicalOrder } from './maps.ts';
import { objectNode, schemaNode } from './nodes.ts';
import { semanticVersionText } from './texts.ts';
import { declaredOrRemoved, declaredOrTombstone } from './tombstones.ts';

const text = z.string();
const codeList = inCanonicalOrder(text, byCodePoint);
const heading = {
  format: z.literal(1),
  name: text,
  version: semanticVersionText,
  generator: text,
};

/** Format 1's Guard, in a published Snapshot and in an exported one. */
export const guard = z.strictObject({
  origin: text,
  description: text,
  guards: z.array(text),
  qualifier: schemaNode.nullable(),
  demands: z.strictObject({ headers: objectNode, query: objectNode }),
  context: schemaNode.nullable(),
  rejections: codeList,
});

/** Format 1's def, in a published Snapshot and in an exported one: never nullable, since every `ref` to it carries `nullable`. */
export const def = schemaNode.refine((node) => node.nullable !== true, {
  message: 'is nullable: a def is written plain, and each ref to it carries nullable',
});

const codeFields = {
  origin: text,
  status: z.number(),
  message: text,
  headers: objectNode,
  body: schemaNode.nullable(),
};

/** Format 1's declared code, in a published Snapshot and in an exported one. */
export const code = z.strictObject(codeFields);

/** Format 1's removed code: what it last had, with `removedIn` and the defs its `ref`s name. */
const removedCode = z.strictObject({
  ...codeFields,
  removedIn: semanticVersionText,
  defs: byKey(def),
});

const publishedCode = declaredOrRemoved(code, removedCode);

const subscription = declaredOrTombstone(
  z.strictObject({ group: text, description: text, event: text }),
  z.strictObject({ event: text, removedIn: semanticVersionText }),
);

/** Format 1's former Input: an Endpoint's query and body as a version declared them, with the defs its `ref`s name. */
const formerInput = z.strictObject({
  endpoint: text,
  removedIn: semanticVersionText,
  input: z.strictObject({ query: objectNode, body: schemaNode.nullable() }),
  defs: byKey(def),
});

/** A Service's former Inputs: by Endpoint in code point order, each Endpoint's in the order recorded, each `removedIn` once. */
const formerInputs = z.array(formerInput).superRefine((held, ctx) => {
  const isOrdered = held.every((former, index) => {
    const previous = held[index - 1];
    return previous === undefined || byCodePoint(previous.endpoint, former.endpoint) <= 0;
  });
  if (!isOrdered || !isEachRemovedInOnce(held)) {
    ctx.addIssue({
      code: 'custom',
      message: 'is not by Endpoint in code point order, each Endpoint’s removedIn once',
    });
  }
});

function isEachRemovedInOnce(held: readonly FormerInput[]): boolean {
  const recorded = held.map(({ endpoint, removedIn }) => canonicalJson([endpoint, removedIn]));
  return new Set(recorded).size === recorded.length;
}

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
  codes: byKey(publishedCode),
  subscriptions: byKey(subscription),
  dependencies,
  formerInputs,
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
  codes: byKey(publishedCode),
});

/** Format 1's structure of a published Snapshot by its kind: every key and value is closed. */
export const publishedSnapshot: z.ZodType<PublishedSnapshot> = z.discriminatedUnion('kind', [
  service,
  application,
  definitions,
]);
