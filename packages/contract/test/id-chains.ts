import { z } from 'zod';
import { kebabCaseOf } from '../src/internal/index.ts';
import type { ChainTable, IdChain } from './id-chain-type.ts';

/** An object of the fields given that holds itself back through an optional field `self`, so its id lies on a cycle of its own. */
function loopedObject(shape: Record<string, z.ZodType>, self: () => z.ZodType): z.ZodType {
  return z.object({
    ...shape,
    get self() {
      return self().optional();
    },
  });
}

/** An object that holds only itself back. */
function loopOnly(self: () => z.ZodType): z.ZodType {
  return loopedObject({}, self);
}

/** The ways one schema holds another that a chain goes through, and the links of the chains that go through each, by the node type of the schema that holds the link before. */
export const chainsByType = {
  object: [
    {
      name: 'field',
      holdings: [['object', 'ref']],
      cycle: 'own',
      linkOf: (previous, self) => loopedObject({ next: previous }, self),
    },
    {
      name: 'inline-lazy',
      holdings: [['object', 'ref']],
      cycle: 'own',
      linkOf: (previous, self) => loopedObject({ next: z.lazy(() => previous) }, self),
    },
    {
      name: 'nullable',
      holdings: [['object', { type: 'ref', nullable: true }]],
      cycle: 'own',
      linkOf: (previous, self) => loopedObject({ next: previous.nullable() }, self),
    },
  ],
  record: [
    {
      name: 'value',
      holdings: [['record', 'ref']],
      cycle: 'group',
      linkOf: (previous) => z.record(z.string(), previous),
    },
    {
      name: 'value-and-field',
      holdings: [
        ['object', 'ref'],
        ['object', 'record', 'ref'],
      ],
      cycle: 'own',
      linkOf: (previous, self) =>
        loopedObject({ next: previous, f: z.record(z.string(), previous) }, self),
    },
  ],
  array: [
    {
      name: 'items',
      holdings: [['array', 'ref']],
      cycle: 'group',
      linkOf: (previous) => z.array(previous),
    },
    {
      name: 'items-and-field',
      holdings: [
        ['object', 'ref'],
        ['object', 'array', 'ref'],
      ],
      cycle: 'own',
      linkOf: (previous, self) => loopedObject({ next: previous, f: z.array(previous) }, self),
    },
  ],
  tuple: [
    {
      name: 'item',
      holdings: [['tuple', 'ref']],
      cycle: 'own',
      linkOf: (previous, self) => z.tuple([previous, loopOnly(self)]),
    },
    {
      name: 'item-and-field',
      holdings: [
        ['object', 'ref'],
        ['object', 'tuple', 'ref'],
      ],
      cycle: 'own',
      linkOf: (previous, self) =>
        loopedObject({ next: previous, f: z.tuple([previous, z.string()]) }, self),
    },
    {
      name: 'rest-and-field',
      holdings: [
        ['object', 'ref'],
        ['object', 'tuple', 'ref'],
      ],
      cycle: 'own',
      linkOf: (previous, self) =>
        loopedObject({ next: previous, f: z.tuple([z.string()], previous) }, self),
    },
  ],
  union: [
    {
      name: 'option',
      holdings: [['union', 'ref']],
      cycle: 'own',
      linkOf: (previous, self) => z.union([previous, z.boolean(), loopOnly(self)]),
    },
    {
      name: 'option-and-field',
      holdings: [
        ['object', 'ref'],
        ['object', 'union', 'ref'],
      ],
      cycle: 'own',
      linkOf: (previous, self) =>
        loopedObject({ next: previous, f: z.union([previous, z.boolean()]) }, self),
    },
  ],
  tagged: [
    {
      name: 'variant-field',
      holdings: [['tagged', 'object', 'ref']],
      cycle: 'own',
      linkOf: (previous, self) =>
        z.discriminatedUnion('k', [
          z.object({ k: z.literal('a'), v: previous }),
          loopedObject({ k: z.literal('b') }, self) as z.ZodObject,
        ]),
    },
    {
      name: 'variant-and-field',
      holdings: [
        ['object', 'ref'],
        ['object', 'tagged', 'ref'],
      ],
      cycle: 'own',
      startOf: () => z.object({ k: z.literal('a'), leaf: z.string() }),
      linkOf: (previous, self) =>
        loopedObject(
          {
            k: z.literal('a'),
            next: previous,
            f: z.discriminatedUnion('k', [
              previous as z.ZodObject,
              z.object({ k: z.literal('b') }),
            ]),
          },
          self,
        ),
    },
  ],
  allOf: [
    {
      name: 'item',
      holdings: [['allOf', 'ref']],
      cycle: 'own',
      linkOf: (previous, self) => z.intersection(previous, loopOnly(self)),
    },
    {
      name: 'item-and-field',
      holdings: [
        ['object', 'ref'],
        ['object', 'allOf', 'ref'],
      ],
      cycle: 'own',
      linkOf: (previous, self) =>
        loopedObject(
          { next: previous, f: z.intersection(previous, z.object({ k: z.string() })) },
          self,
        ),
    },
  ],
  ref: [
    {
      name: 'alias',
      holdings: [['ref']],
      cycle: 'group',
      linkOf: (previous) => z.lazy(() => previous),
    },
  ],
  string: [],
  number: [],
  boolean: [],
  enum: [],
  json: [],
} as const satisfies ChainTable;

/** The node types whose node holds a schema: the keys of `chainsByType` with chains. */
export type HolderType = {
  [Type in keyof typeof chainsByType]: (typeof chainsByType)[Type] extends readonly []
    ? never
    : Type;
}[keyof typeof chainsByType];

/** Every chain with the node type that holds the link before it, and the stem of its file: `id-chains.<type in kebab-case>.<name>`. */
export type TableChain = IdChain & { readonly type: HolderType; readonly stem: string };

/** Every chain of `chainsByType`, in table order. */
export const idChains: readonly TableChain[] = (
  Object.entries(chainsByType) as [HolderType, readonly IdChain[]][]
).flatMap(([type, chains]) =>
  chains.map((chain) => ({ ...chain, type, stem: `id-chains.${kebabCaseOf(type)}.${chain.name}` })),
);
