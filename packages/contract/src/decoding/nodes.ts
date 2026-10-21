import { z } from 'zod';
import type { SchemaNode } from '../walker/index.ts';
import { stringFormatText } from './texts.ts';

const annotations = {
  nullable: z.literal(true).exactOptional(),
  description: z.string().exactOptional(),
  examples: z.array(z.unknown()).exactOptional(),
  origin: z.string().exactOptional(),
};

const bound = z.number().exactOptional();
const primitive = z.union([z.string(), z.number(), z.boolean()]);

function node<const Type extends string, Shape extends z.core.$ZodShape>(type: Type, shape: Shape) {
  return z.strictObject({ type: z.literal(type), ...annotations, ...shape });
}

const child: z.ZodType<SchemaNode> = z.lazy(() => schemaNode);
const field = z.strictObject({ required: z.boolean(), schema: child });

/** Format 1's object node, which an Endpoint's Input and a Guard's demands are made of. */
export const objectNode = node('object', {
  mode: z.enum(['open', 'strict']),
  fields: z.record(z.string(), field),
});
const refNode = node('ref', { name: z.string() });

const nodes = [
  node('string', {
    format: stringFormatText.exactOptional(),
    formatOptions: z.record(z.string(), z.unknown()).exactOptional(),
    regex: z.strictObject({ source: z.string(), flags: z.string() }).exactOptional(),
    min: bound,
    max: bound,
  }),
  node('number', {
    int: z.literal(true).exactOptional(),
    min: bound,
    max: bound,
    exclusiveMin: bound,
    exclusiveMax: bound,
    multipleOf: bound,
  }),
  node('boolean', {}),
  node('literal', { value: primitive }),
  node('enum', { values: z.array(primitive), open: z.boolean() }),
  objectNode,
  node('record', { key: child, value: child }),
  node('array', { items: child, min: bound, max: bound }),
  node('tuple', { items: z.array(child), rest: child.exactOptional() }),
  node('union', { options: z.array(child) }),
  node('tagged', {
    discriminator: z.string(),
    variants: z.record(z.string(), z.discriminatedUnion('type', [objectNode, refNode])),
  }),
  node('allOf', { items: z.array(child) }),
  node('json', {}),
  refNode,
] as const;

/** Format 1's structure of a schema node, whose type, constraints and annotations are all closed. */
export const schemaNode: z.ZodType<SchemaNode> = z.lazy(() => z.discriminatedUnion('type', nodes));
