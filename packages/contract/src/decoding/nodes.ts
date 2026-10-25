import { z } from 'zod';
import {
  byCanonicalJson,
  emptyConstraintOf,
  formatOptionKeysOf,
  type SchemaNode,
  type StringNode,
} from '../walker/index.ts';
import { byKey, inCanonicalOrder } from './maps.ts';
import { stringFormatText } from './texts.ts';

const keyAnnotations = {
  description: z.string().exactOptional(),
  examples: z.array(z.unknown()).exactOptional(),
  origin: z.string().exactOptional(),
};

const annotations = { nullable: z.literal(true).exactOptional(), ...keyAnnotations };

const bound = z.number().exactOptional();
const primitive = z.union([z.string(), z.number(), z.boolean()]);

function node<const Type extends string, Shape extends z.core.$ZodShape>(type: Type, shape: Shape) {
  return z.strictObject({ type: z.literal(type), ...annotations, ...shape });
}

const child: z.ZodType<SchemaNode> = z.lazy(() => schemaNode);
const field = z.strictObject({ required: z.boolean(), schema: child });

/** Format 1's object node, which an Endpoint's Input and a Guard's demands are made of. */
export const objectNode = node('object', {
  fields: byKey(field),
});
const refNode = node('ref', { name: z.string() });

const regex = z.strictObject({ source: z.string(), flags: z.string() });

/** The value each string format option takes, as the walker writes it. */
const formatOptionValues: Readonly<Record<string, z.ZodType>> = {
  version: z.string(),
  alg: z.string(),
  delimiter: z.string(),
  offset: z.boolean(),
  local: z.boolean(),
  precision: z.int(),
  protocol: regex,
  hostname: regex,
};

const stringOptions = {
  format: stringFormatText.exactOptional(),
  formatOptions: byKey(z.unknown()).exactOptional(),
  regex: regex.exactOptional(),
  min: bound,
  max: bound,
};

/** A string node's options are those its string format takes. */
function checkedFormatOptions(
  { format, formatOptions }: Pick<StringNode, 'format' | 'formatOptions'>,
  ctx: z.RefinementCtx,
): void {
  const taken = formatOptionKeysOf(format);
  for (const [option, value] of Object.entries(formatOptions ?? {})) {
    const path = ['formatOptions', option];
    if (!taken.includes(option)) {
      ctx.addIssue({ code: 'custom', message: 'is no option of the string format', path });
    } else if (formatOptionValues[option]?.safeParse(value).success !== true) {
      ctx.addIssue({ code: 'custom', message: 'is not a value that option takes', path });
    }
  }
}

/** A node's bounds admit a value, by the rule the walker writes them with. */
function checkedBounds(bounded: SchemaNode, ctx: z.RefinementCtx): void {
  const refusal = emptyConstraintOf(bounded);
  if (refusal !== undefined) {
    ctx.addIssue({ code: 'custom', message: `holds ${refusal.construct}`, path: [] });
  }
}

const stringNode = node('string', stringOptions)
  .superRefine(checkedFormatOptions)
  .superRefine(checkedBounds);

/** A record's key: a string node that is never nullable, since the walker refuses a nullable key. */
const recordKeyNode = z
  .strictObject({ type: z.literal('string'), ...keyAnnotations, ...stringOptions })
  .superRefine(checkedFormatOptions)
  .superRefine(checkedBounds);

const nodes = [
  stringNode,
  node('number', {
    int: z.literal(true).exactOptional(),
    min: bound,
    max: bound,
    exclusiveMin: bound,
    exclusiveMax: bound,
    multipleOf: bound,
  }).superRefine(checkedBounds),
  node('boolean', {}),
  node('enum', { values: inCanonicalOrder(primitive, byCanonicalJson).min(1), open: z.boolean() }),
  objectNode,
  node('record', { key: recordKeyNode, value: child }),
  node('array', { items: child, min: bound, max: bound }).superRefine(checkedBounds),
  node('tuple', { items: z.array(child), rest: child.exactOptional() }),
  node('union', { options: z.array(child).min(1) }),
  node('tagged', {
    discriminator: z.string(),
    variants: byKey(z.discriminatedUnion('type', [objectNode, refNode])).refine(
      (variants) => Object.keys(variants).length > 0,
      'holds no variant',
    ),
  }),
  node('allOf', { items: inCanonicalOrder(child, byCanonicalJson) }),
  node('json', {}),
  refNode,
] as const;

/** Format 1's structure of a schema node, whose type, constraints and annotations are all closed. */
export const schemaNode: z.ZodType<SchemaNode> = z.lazy(() => z.discriminatedUnion('type', nodes));
