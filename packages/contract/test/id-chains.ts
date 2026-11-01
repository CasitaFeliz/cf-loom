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
      holds: 1,
      wayOfHolding: 'a field',
      cycle: 'own',
      linkOf: (previous, self) => loopedObject({ next: previous }, self),
    },
    {
      name: 'inline-lazy',
      holds: 1,
      wayOfHolding: 'an inline `z.lazy()`',
      cycle: 'own',
      linkOf: (previous, self) => loopedObject({ next: z.lazy(() => previous) }, self),
    },
    {
      name: 'nullable',
      holds: 1,
      nullable: true,
      wayOfHolding: 'a `.nullable()` field',
      cycle: 'own',
      linkOf: (previous, self) => loopedObject({ next: previous.nullable() }, self),
    },
  ],
  record: [
    {
      name: 'value',
      holds: 1,
      wayOfHolding: "a record's value",
      cycle: 'group',
      linkOf: (previous) => z.record(z.string(), previous),
    },
    {
      name: 'value-and-field',
      holds: 2,
      wayOfHolding: "a record's value, and a field",
      cycle: 'own',
      linkOf: (previous, self) =>
        loopedObject({ next: previous, f: z.record(z.string(), previous) }, self),
    },
  ],
  array: [
    {
      name: 'items',
      holds: 1,
      wayOfHolding: "an array's items",
      cycle: 'group',
      linkOf: (previous) => z.array(previous),
    },
    {
      name: 'items-and-field',
      holds: 2,
      wayOfHolding: "an array's items, and a field",
      cycle: 'own',
      linkOf: (previous, self) => loopedObject({ next: previous, f: z.array(previous) }, self),
    },
  ],
  tuple: [
    {
      name: 'item',
      holds: 1,
      wayOfHolding: "a tuple's item",
      cycle: 'own',
      linkOf: (previous, self) => z.tuple([previous, loopOnly(self)]),
    },
    {
      name: 'item-and-field',
      holds: 2,
      wayOfHolding: "a tuple's item, and a field",
      cycle: 'own',
      linkOf: (previous, self) =>
        loopedObject({ next: previous, f: z.tuple([previous, z.string()]) }, self),
    },
    {
      name: 'rest-and-field',
      holds: 2,
      wayOfHolding: "a tuple's rest, and a field",
      cycle: 'own',
      linkOf: (previous, self) =>
        loopedObject({ next: previous, f: z.tuple([z.string()], previous) }, self),
    },
  ],
  union: [
    {
      name: 'option',
      holds: 1,
      wayOfHolding: "a union's option",
      cycle: 'own',
      linkOf: (previous, self) => z.union([previous, z.boolean(), loopOnly(self)]),
    },
    {
      name: 'option-and-field',
      holds: 2,
      wayOfHolding: "a union's option, and a field",
      cycle: 'own',
      linkOf: (previous, self) =>
        loopedObject({ next: previous, f: z.union([previous, z.boolean()]) }, self),
    },
  ],
  tagged: [
    {
      name: 'variant-field',
      holds: 1,
      wayOfHolding: "a variant's field",
      cycle: 'own',
      linkOf: (previous, self) =>
        z.discriminatedUnion('k', [
          z.object({ k: z.literal('a'), v: previous }),
          loopedObject({ k: z.literal('b') }, self) as z.ZodObject,
        ]),
    },
    {
      name: 'variant-and-field',
      holds: 2,
      wayOfHolding: 'a variant that is the link before, and a field',
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
      holds: 1,
      wayOfHolding: "an intersection's item",
      cycle: 'own',
      linkOf: (previous, self) => z.intersection(previous, loopOnly(self)),
    },
    {
      name: 'item-and-field',
      holds: 2,
      wayOfHolding: "an intersection's item, and a field",
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
      holds: 1,
      wayOfHolding: 'an alias',
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
