import { z } from 'zod';
import { seededNext } from './random-schemas.ts';

/** What a schema of the graph is: the node it builds and so what it holds the schemas it names in. */
export type Kind = 'union' | 'allOf' | 'alias' | 'object' | 'array' | 'record' | 'tuple' | 'tagged';

export const kinds: readonly Kind[] = [
  'union',
  'allOf',
  'alias',
  'object',
  'array',
  'record',
  'tuple',
  'tagged',
];

/** What stands around a held schema: nothing, `.nullable()`, a description, a union, an intersection or an array. */
export type Around = 'nothing' | 'nullable' | 'described' | 'union' | 'allOf' | 'array';

export const arounds: readonly Around[] = [
  'nothing',
  'nullable',
  'described',
  'union',
  'allOf',
  'array',
];

/** How a schema reaches the one it holds: through a `z.lazy()` with no id, or directly, once that is built. */
export type Reach = 'direct' | 'lazy';

/** One schema a schema of the graph holds, and what stands between them. */
export type Hold = { readonly to: number; readonly reach: Reach; readonly around: Around };

/**
 * A seeded graph of 2 to 8 schemas, each of one kind and holding one to three others in a fixed
 * order, with an id on exactly those that lie on a cycle of the holds, and one to three
 * declarations that walk it. No schema is nullable and none holds an id the walk would refuse, so
 * the only refusal it can draw is a cycle through `z.lazy()`, unions and intersections alone.
 */
export type NodelessGraph = {
  readonly kinds: readonly Kind[];
  readonly holds: readonly (readonly Hold[])[];
  readonly hasId: readonly boolean[];
  readonly schemas: readonly z.ZodType[];
  readonly declarations: readonly number[];
};

/** The graph a seed draws, the same every run, so a failing draw can be replayed. */
export function nodelessGraph(seed: number): NodelessGraph {
  const next = seededNext(seed);
  const size = 2 + Math.floor(next() * 7);
  const kindList: Kind[] = [];
  const holds: Hold[][] = [];
  for (let index = 0; index < size; index++) {
    const kind = kindOf(next);
    kindList.push(kind);
    holds.push(holdsOf({ next, kind, index, size }));
  }
  const hasId = holds.map((_, index) => reachableFrom(holds, index).has(index));
  const declarations = Array.from({ length: 1 + Math.floor(next() * 3) }, () =>
    Math.floor(next() * size),
  );
  return {
    kinds: kindList,
    holds,
    hasId,
    schemas: schemasOf(kindList, holds, hasId),
    declarations,
  };
}

function kindOf(next: () => number): Kind {
  const roll = next();
  if (roll < 0.55) {
    const nodeless: readonly Kind[] = ['union', 'union', 'allOf', 'alias', 'alias'];
    return nodeless[Math.floor(next() * nodeless.length)] ?? 'union';
  }
  return kinds[3 + Math.floor(next() * 5)] ?? 'object';
}

/** What draws a hold: the numbers, and where the holder sits among the schemas. */
type HoldDraw = {
  readonly next: () => number;
  readonly kind: Kind;
  readonly index: number;
  readonly size: number;
};

function holdsOf(draw: HoldDraw): Hold[] {
  const isSingle = ['alias', 'array', 'record'].includes(draw.kind);
  const count = isSingle ? 1 : 1 + Math.floor(draw.next() * 3);
  return Array.from({ length: count }, () => holdOf(draw));
}

/** A hold of any schema, itself included; a direct one only of a schema built before, which an alias never makes. */
function holdOf({ next, kind, index, size }: HoldDraw): Hold {
  const to = Math.floor(next() * size);
  const isLazy = to >= index || kind === 'alias' || next() < 0.5;
  const reach: Reach = isLazy ? 'lazy' : 'direct';
  return { to, reach, around: aroundOf(next, kind, reach) };
}

/** An alias is described on its own meta or not at all; a description needs a `z.lazy()` of its own to stand on. */
function aroundOf(next: () => number, kind: Kind, reach: Reach): Around {
  const pool = kind === 'alias' ? arounds.slice(0, 1).concat('described') : arounds;
  const around = pool[Math.floor(next() * pool.length)] ?? 'nothing';
  return around === 'described' && reach === 'direct' ? 'nothing' : around;
}

/** Every schema reached from a schema through one hold or more, itself only if a hold leads back. */
function reachableFrom(holds: readonly (readonly Hold[])[], from: number): ReadonlySet<number> {
  const reached = new Set<number>();
  const pending = [from];
  for (let index = pending.pop(); index !== undefined; index = pending.pop()) {
    for (const { to } of holds[index] ?? []) {
      if (!reached.has(to)) {
        reached.add(to);
        pending.push(to);
      }
    }
  }
  return reached;
}

function schemasOf(
  kindList: readonly Kind[],
  holds: readonly (readonly Hold[])[],
  hasId: readonly boolean[],
): z.ZodType[] {
  const schemas: z.ZodType[] = [];
  for (const [index, kind] of kindList.entries()) {
    const holding = holds[index] ?? [];
    const isDescribedAlias = kind === 'alias' && holding[0]?.around === 'described';
    const held = holding.map((hold) =>
      heldBy(kind === 'alias' ? { ...hold, around: 'nothing' } : hold, schemas),
    );
    const schema = holderOf(kind, held);
    const meta = {
      ...(hasId[index] === true && { id: `n${index}` }),
      ...(isDescribedAlias && { description: 'Itself' }),
    };
    schemas.push(Object.keys(meta).length === 0 ? schema : schema.meta(meta));
  }
  return schemas;
}

function heldBy({ to, reach, around }: Hold, schemas: readonly z.ZodType[]): z.ZodType {
  const target = reach === 'direct' ? schemaAt(schemas, to) : z.lazy(() => schemaAt(schemas, to));
  switch (around) {
    case 'nothing':
      return target;
    case 'nullable':
      return target.nullable();
    case 'described':
      return target.describe('d');
    case 'union':
      return z.union([target, z.string()]);
    case 'allOf':
      return z.intersection(z.object({ a: z.string() }), target);
    case 'array':
      return z.array(target);
  }
}

function schemaAt(schemas: readonly z.ZodType[], index: number): z.ZodType {
  const schema = schemas[index];
  if (schema === undefined) {
    throw new Error(`The graph holds a schema at ${index}.`);
  }
  return schema;
}

function holderOf(kind: Kind, held: readonly z.ZodType[]): z.ZodType {
  const first = held[0] ?? z.never();
  switch (kind) {
    case 'union':
      return z.union([...held, z.string()]);
    case 'allOf':
      return intersectionOf(held.length > 1 ? held : [z.object({ a: z.string() }), first]);
    case 'alias':
      return z.lazy(() => first);
    case 'object':
      return z.object(Object.fromEntries(held.map((schema, field) => [`f${field}`, schema])));
    case 'array':
      return z.array(first);
    case 'record':
      return z.record(z.string(), first);
    case 'tuple':
      return z.tuple([first, ...held.slice(1)]);
    case 'tagged':
      return taggedOf(held);
  }
}

function intersectionOf(items: readonly z.ZodType[]): z.ZodType {
  const [left, right, ...rest] = items;
  let schema = z.intersection(left ?? z.never(), right ?? z.never());
  for (const item of rest) {
    schema = z.intersection(schema, item);
  }
  return schema;
}

function variantOf(schema: z.ZodType, index: number) {
  return z.object({ kind: z.literal(`v${index}`), value: schema });
}

function taggedOf(held: readonly z.ZodType[]): z.ZodType {
  const [first, ...rest] = held;
  return z.discriminatedUnion('kind', [
    variantOf(first ?? z.never(), 0),
    ...rest.map((schema, index) => variantOf(schema, index + 1)),
  ]);
}
