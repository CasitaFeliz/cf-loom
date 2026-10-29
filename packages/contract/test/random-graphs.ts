import { z } from 'zod';
import { seededNext } from './random-schemas.ts';

/**
 * How a schema of a random graph is named: an id, none, an id the walk refuses, the id another
 * schema may have too, or an id on the schema made nullable.
 */
export type Naming = 'id' | 'none' | 'refusedId' | 'takenId' | 'nullableId';

/** What a random graph draws: every naming and holding, every schema with an id, or arrays only. */
export type Mix = 'mixed' | 'ids' | 'arrays';

const holdings = ['array', 'lazy', 'union', 'intersection', 'optional', 'getter'] as const;

/**
 * How a schema holds another: in an array, a `z.lazy()`, a union, an intersection, an `.optional()`
 * field, or a getter.
 */
type Holding = (typeof holdings)[number];

/** What one schema of a random graph is drawn with. */
type Drawn = {
  readonly holds: readonly number[];
  readonly holdings: readonly Holding[];
  readonly naming: Naming;
  readonly isFailing: boolean;
  readonly isTooDeep: boolean;
};

/**
 * A seeded graph of 2 to 6 object schemas, each holding up to two others, and what the graph says
 * of each: whether it lies on a cycle, and whether it reaches a schema nested 257 arrays deep.
 */
export type RandomGraph = {
  readonly schemas: readonly z.ZodType[];
  readonly namings: readonly Naming[];
  /** The two schemas a walk enters the graph at. */
  readonly roots: readonly number[];
  readonly isOnCycle: readonly boolean[];
  readonly reachesTooDeep: readonly boolean[];
  /** The schemas the roots reach, the roots included. */
  readonly reached: ReadonlySet<number>;
};

/** The random graph a seed draws, the same every run, so a failing draw can be replayed. */
export function randomGraph(seed: number, mix: Mix): RandomGraph {
  const next = seededNext(seed);
  const size = 2 + Math.floor(next() * 5);
  const drawn = Array.from({ length: size }, () => drawnSchema(next, size, mix));
  const schemas: z.ZodType[] = [];
  for (const [index, schema] of drawn.entries()) {
    schemas.push(schemaOf(schema, index, schemas));
  }
  const roots = [Math.floor(next() * size), Math.floor(next() * size)];
  const holds = drawn.map((schema) => schema.holds);
  const reachedFrom = holds.map((_, index) => reachedBy(holds, holds[index] ?? []));
  return {
    schemas,
    namings: drawn.map((schema) => schema.naming),
    roots,
    isOnCycle: reachedFrom.map((reached, index) => reached.has(index)),
    reachesTooDeep: reachedFrom.map((reached, index) =>
      [index, ...reached].some((held) => drawn[held]?.isTooDeep === true),
    ),
    reached: reachedBy(holds, roots),
  };
}

/** The id the walk reads on a schema of the graph, none when it has none. */
export function idOf(graph: RandomGraph, index: number): string | undefined {
  const naming = graph.namings[index] ?? 'none';
  switch (naming) {
    case 'id':
    case 'nullableId':
      return `n${index}`;
    case 'refusedId':
      return `n_${index}`;
    case 'takenId':
      return 'shared';
    case 'none':
      return undefined;
  }
}

function drawnSchema(next: () => number, size: number, mix: Mix): Drawn {
  const drawnHolds = Array.from({ length: Math.floor(next() * 3) }, () =>
    Math.floor(next() * size),
  );
  const holds = [...new Set(drawnHolds)];
  const naming = mix === 'ids' ? 'id' : namingOf(next());
  const isFailing = next() < 0.2;
  const isTooDeep = mix !== 'ids' && next() < 0.1;
  const holdingsOf = holds.map(() =>
    mix === 'arrays' ? 'array' : holdings[Math.floor(next() * holdings.length)],
  );
  return {
    holds,
    holdings: holdingsOf.map((holding) => holding ?? 'array'),
    naming,
    isFailing,
    isTooDeep,
  };
}

function namingOf(draw: number): Naming {
  const thresholds: readonly [number, Naming][] = [
    [0.5, 'id'],
    [0.65, 'none'],
    [0.75, 'refusedId'],
    [0.87, 'takenId'],
  ];
  return thresholds.find(([threshold]) => draw < threshold)?.[1] ?? 'nullableId';
}

/** A schema of the graph: an object with a field per schema it holds, read through a getter. */
function schemaOf(drawn: Drawn, index: number, schemas: readonly z.ZodType[]): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  if (drawn.isFailing) {
    shape['bad'] = z.date();
  }
  if (drawn.isTooDeep) {
    shape['deep'] = arraysAround(257, z.string());
  }
  for (const [position, held] of drawn.holds.entries()) {
    const holding = drawn.holdings[position] ?? 'array';
    Object.defineProperty(shape, `e${held}`, {
      enumerable: true,
      get: () => heldBy(holding, () => schemaAt(schemas, held)),
    });
  }
  return named(z.object(shape), drawn.naming, index);
}

function named(schema: z.ZodObject, naming: Naming, index: number): z.ZodType {
  switch (naming) {
    case 'id':
      return schema.meta({ id: `n${index}` });
    case 'refusedId':
      return schema.meta({ id: `n_${index}` });
    case 'takenId':
      return schema.meta({ id: 'shared' });
    case 'nullableId':
      return schema.nullable().meta({ id: `n${index}` });
    case 'none':
      return schema;
  }
}

function heldBy(holding: Holding, held: () => z.ZodType): z.ZodType {
  switch (holding) {
    case 'array':
      return z.array(held());
    case 'lazy':
      return z.array(z.lazy(held));
    case 'union':
      return z.array(z.union([held(), z.string()]));
    case 'intersection':
      return z.array(z.intersection(held(), z.object({ k: z.string() })));
    case 'optional':
      return z.array(held()).optional();
    case 'getter':
      return held();
  }
}

function schemaAt(schemas: readonly z.ZodType[], index: number): z.ZodType {
  const schema = schemas[index];
  if (schema === undefined) {
    throw new Error(`The graph holds a schema at ${index}.`);
  }
  return schema;
}

function arraysAround(count: number, inner: z.ZodType): z.ZodType {
  let schema = inner;
  for (let index = 0; index < count; index++) {
    schema = z.array(schema);
  }
  return schema;
}

/** The schemas reached from `from` through one hold or more, `from` included. */
function reachedBy(holds: readonly (readonly number[])[], from: readonly number[]): Set<number> {
  const reached = new Set(from);
  const pending = [...from];
  for (let schema = pending.pop(); schema !== undefined; schema = pending.pop()) {
    for (const held of holds[schema] ?? []) {
      if (!reached.has(held)) {
        reached.add(held);
        pending.push(held);
      }
    }
  }
  return reached;
}
