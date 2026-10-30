import { z } from 'zod';
import { seededNext } from './random-schemas.ts';

/** How a schema of a reentry graph holds another: an `.optional()` field, an array, a union or a record. */
type Wrap = 'optional' | 'array' | 'union' | 'record';

const wraps: readonly Wrap[] = ['optional', 'array', 'union', 'record'];

/** The step a hold adds to a location, in the author's terms: none for an `.optional()` field. */
const stepText: Readonly<Record<Wrap, string>> = {
  optional: '',
  array: '[]',
  union: '<|1>',
  record: '{}',
};

/** One field of a schema of the graph: the schema it holds, and how. */
type Hold = { readonly to: number; readonly wrap: Wrap };

/**
 * A seeded graph of 3 to 11 object schemas, each holding one to three others and sometimes a
 * `z.date()`, most of them with an id, walked from three roots. It is drawn to meet a schema again
 * while the same schema is on the walk's path twice, and to fail a def inside a failing def.
 */
export type ReentryGraph = {
  readonly schemas: readonly z.ZodType[];
  readonly holds: readonly (readonly Hold[])[];
  readonly hasId: readonly boolean[];
  readonly hasDate: readonly boolean[];
  readonly roots: readonly number[];
};

/** The graph a seed draws, the same every run, so a failing draw can be replayed. */
export function reentryGraph(seed: number): ReentryGraph {
  const next = seededNext(seed);
  const size = 3 + Math.floor(next() * 9);
  const hasId: boolean[] = [];
  const hasDate: boolean[] = [];
  const holds: Hold[][] = [];
  for (let index = 0; index < size; index++) {
    hasId.push(next() < 0.65);
    holds.push(holdsOf(next, size));
    hasDate.push(next() < 0.45);
  }
  const roots = [0, size - 1, Math.floor(next() * size)];
  return { schemas: schemasOf(holds, hasId, hasDate), holds, hasId, hasDate, roots };
}

function holdsOf(next: () => number, size: number): Hold[] {
  const held: Hold[] = [];
  for (let count = 1 + Math.floor(next() * 3); count > 0; count--) {
    const to = Math.floor(next() * size);
    held.push({ to, wrap: wraps[Math.floor(next() * wraps.length)] ?? 'optional' });
  }
  return held;
}

function schemasOf(
  holds: readonly (readonly Hold[])[],
  hasId: readonly boolean[],
  hasDate: readonly boolean[],
): z.ZodType[] {
  const schemas: z.ZodType[] = [];
  for (const [index, held] of holds.entries()) {
    const shape: Record<string, z.ZodType> = {};
    for (const [field, { to, wrap }] of held.entries()) {
      Object.defineProperty(shape, `e${field}`, {
        enumerable: true,
        get: () => heldBy(wrap, schemaAt(schemas, to)),
      });
    }
    if (hasDate[index]) {
      shape['d'] = z.date();
    }
    const object = z.object(shape);
    schemas.push(hasId[index] ? object.meta({ id: `n${index}` }) : object);
  }
  return schemas;
}

function heldBy(wrap: Wrap, held: z.ZodType): z.ZodType {
  switch (wrap) {
    case 'optional':
      return held.optional();
    case 'array':
      return z.array(held).optional();
    case 'union':
      return z.union([z.string(), held]).optional();
    case 'record':
      return z.record(z.string(), held).optional();
  }
}

function schemaAt(schemas: readonly z.ZodType[], index: number): z.ZodType {
  const schema = schemas[index];
  if (schema === undefined) {
    throw new Error(`The graph holds a schema at ${index}.`);
  }
  return schema;
}

/** The schemas reached from `from` through one hold or more, `from` itself only if a hold leads back. */
function reachedFrom(graph: ReentryGraph, from: number): ReadonlySet<number> {
  const reached = new Set<number>();
  const pending = [from];
  for (let index = pending.pop(); index !== undefined; index = pending.pop()) {
    for (const { to } of graph.holds[index] ?? []) {
      if (!reached.has(to)) {
        reached.add(to);
        pending.push(to);
      }
    }
  }
  return reached;
}

/** Whether a schema lies on a cycle of the graph, one or more holds that lead back to it. */
export function isOnCycle(graph: ReentryGraph, index: number): boolean {
  return reachedFrom(graph, index).has(index);
}

/** Whether a schema is a `z.date()` holder itself or reaches one: the walk refuses it wherever it is used. */
export function reachesDate(graph: ReentryGraph, index: number): boolean {
  return [index, ...reachedFrom(graph, index)].some((held) => graph.hasDate[held] === true);
}

/** Whether two schemas with an id lie on one cycle and one holds a date: a def fails inside another. */
export function failsInsideGroup(graph: ReentryGraph): boolean {
  const ids = [...graph.hasId.keys()].filter((index) => graph.hasId[index] === true);
  return ids.some((outer) =>
    ids.some(
      (inner) =>
        inner !== outer &&
        graph.hasDate[inner] === true &&
        reachedFrom(graph, outer).has(inner) &&
        reachedFrom(graph, inner).has(outer),
    ),
  );
}

/** The cycles no id names that a plain walk of the graph meets, and how often it enters a schema already on its path. */
export type CycleMeetings = {
  /** The exports the roots are walked as, `r0`, `r1` and `r2`, and the locations, `exports.r0 e0.e2`, where the walk refuses a cycle. */
  readonly lines: ReadonlySet<string>;
  /** How many times the walk enters a schema without an id that is already on its path. */
  readonly reentries: number;
};

type Meeting = {
  readonly graph: ReentryGraph;
  readonly lines: Set<string>;
  readonly remembered: Set<number>;
  readonly path: number[];
  /** The root being walked, as its site is named. */
  site: string;
  reentries: number;
};

/**
 * What a plain depth-first walk of the graph refuses as a cycle no id names, in the order the
 * walker walks: a schema met again with an id is a `ref`, one with no id on a cycle none of whose
 * schemas has an id is refused there and remembered with the cycle, and one on a cycle through an
 * id is entered again. A schema with an id is remembered once it is walked.
 */
export function cycleMeetingsOf(graph: ReentryGraph): CycleMeetings {
  const meeting: Meeting = {
    graph,
    lines: new Set(),
    remembered: new Set(),
    path: [],
    site: '',
    reentries: 0,
  };
  for (const [position, root] of graph.roots.entries()) {
    meeting.site = `exports.r${position}`;
    meet(meeting, root, '');
  }
  return { lines: meeting.lines, reentries: meeting.reentries };
}

function meet(meeting: Meeting, index: number, location: string): void {
  const { graph, path, remembered } = meeting;
  if (remembered.has(index)) {
    return;
  }
  const closing = path.lastIndexOf(index);
  if (closing >= 0 && graph.hasId[index] === true) {
    return;
  }
  if (closing >= 0 && !path.slice(closing).some((held) => graph.hasId[held] === true)) {
    meeting.lines.add(`${meeting.site} ${location}`);
    for (const held of path.slice(closing)) {
      remembered.add(held);
    }
    return;
  }
  if (closing >= 0) {
    meeting.reentries++;
  }
  path.push(index);
  for (const [field, { to, wrap }] of (graph.holds[index] ?? []).entries()) {
    const step = `e${field}${stepText[wrap]}`;
    meet(meeting, to, location === '' ? step : `${location}.${step}`);
  }
  path.pop();
  if (graph.hasId[index] === true) {
    remembered.add(index);
  }
}
