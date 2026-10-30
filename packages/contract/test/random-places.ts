import { z } from 'zod';
import { tokenOf } from '../src/internal/index.ts';

/** One step of a recorded path as an author reads it: a named field, or a suffix such as `[]` or `{}`. */
export type Piece = { readonly text: string; readonly isField: boolean };

/** What adds a step to a place: a field, an `.optional()` field, an array's items, a tuple's item or rest, a record's key or value, a union's option, a variant, an intersection's item. */
export type Construct =
  | 'field'
  | 'optional'
  | 'items'
  | 'index'
  | 'rest'
  | 'key'
  | 'value'
  | 'option'
  | 'variant'
  | 'intersection';

/** Every construct a random schema is drawn from. */
export const constructs: readonly Construct[] = [
  'field',
  'optional',
  'items',
  'index',
  'rest',
  'key',
  'value',
  'option',
  'variant',
  'intersection',
];

/** A leaf of a random schema, the steps down to it as they were recorded while it was built, and what they cross. */
export type Leaf = { readonly steps: readonly Piece[]; readonly crossing: readonly Construct[] };

/** A random schema and the leaves the generator put in it. */
export type RandomSchema = { readonly schema: z.ZodType; readonly leaves: readonly Leaf[] };

/** What a random schema is drawn with: the leaf it puts at the bottom, none for a plain string, and whether a record's key may hold one. */
export type Drawing = {
  readonly next: () => number;
  readonly leaf: () => z.ZodType | undefined;
  readonly keysHoldLeaves: boolean;
};

/** How a kind of node builds a child: nested further, or as a leaf at once. */
type Below = {
  readonly nested: (via: readonly Piece[], crossing: readonly Construct[]) => RandomSchema;
  readonly leaf: (via: readonly Piece[], crossing: readonly Construct[]) => RandomSchema;
};

const names = ['a', 'b', 'two words'];

const field = (name: string): Piece => ({ text: tokenOf(name), isField: true });
const suffix = (text: string): Piece => ({ text, isField: false });

/** The steps as a path reads them from a place's root: `a[].b`. */
export function pathTextOf(steps: readonly Piece[]): string {
  const tail = tailTextOf(steps);
  return tail.startsWith('.') ? tail.slice(1) : tail;
}

/** The steps as they continue a path that already has a step: `.a[].b`. */
export function tailTextOf(steps: readonly Piece[]): string {
  return steps.map((piece) => (piece.isField ? `.${piece.text}` : piece.text)).join('');
}

/** The steps of a leaf inside an object's field `name`. */
export function inField(name: string, steps: readonly Piece[]): readonly Piece[] {
  return [field(name), ...steps];
}

/** A random schema nested up to `depth` constructs deep, with a leaf wherever a branch ends. */
export function randomNested(drawing: Drawing, depth: number): RandomSchema {
  if (depth <= 0 || drawing.next() < 0.1) {
    return leafOf(drawing, [], []);
  }
  const below: Below = {
    nested: (via, crossing) => prefixed(randomNested(drawing, depth - 1), via, crossing),
    leaf: (via, crossing) => leafOf(drawing, via, crossing),
  };
  const kinds = drawing.keysHoldLeaves ? [...plainKinds, aRecordWithKey] : plainKinds;
  const kind = kinds[Math.floor(drawing.next() * kinds.length)] ?? anObject;
  return kind(drawing.next, below);
}

function leafOf(drawing: Drawing, via: readonly Piece[], crossing: readonly Construct[]) {
  const leaf = drawing.leaf();
  return leaf === undefined
    ? { schema: z.string(), leaves: [] }
    : { schema: leaf, leaves: [{ steps: via, crossing }] };
}

function prefixed(child: RandomSchema, via: readonly Piece[], crossing: readonly Construct[]) {
  const leaves = child.leaves.map((leaf) => ({
    steps: [...via, ...leaf.steps],
    crossing: [...crossing, ...leaf.crossing],
  }));
  return { schema: child.schema, leaves };
}

type Kind = (next: () => number, below: Below) => RandomSchema;

function twoNames(next: () => number): readonly [string, string] {
  const first = Math.floor(next() * names.length);
  const second = (first + 1 + Math.floor(next() * (names.length - 1))) % names.length;
  return [names[first] ?? 'a', names[second] ?? 'b'];
}

const anObject: Kind = (next, below) => {
  const [first, second] = twoNames(next);
  const held = below.nested([field(first)], ['field']);
  const optional = below.nested([field(second)], ['field', 'optional']);
  return {
    schema: z.object({ [first]: held.schema, [second]: optional.schema.optional() }),
    leaves: [...held.leaves, ...optional.leaves],
  };
};

const anArray: Kind = (_next, below) => {
  const items = below.nested([suffix('[]')], ['items']);
  return { schema: z.array(items.schema), leaves: items.leaves };
};

const aTuple: Kind = (_next, below) => {
  const first = below.nested([suffix('[0]')], ['index']);
  const second = below.nested([suffix('[1]')], ['index']);
  return {
    schema: z.tuple([first.schema, second.schema]),
    leaves: [...first.leaves, ...second.leaves],
  };
};

const aTupleWithRest: Kind = (_next, below) => {
  const first = below.nested([suffix('[0]')], ['index']);
  const rest = below.nested([suffix('[...]')], ['rest']);
  return {
    schema: z.tuple([first.schema], rest.schema),
    leaves: [...first.leaves, ...rest.leaves],
  };
};

const aRecord: Kind = (_next, below) => {
  const value = below.nested([suffix('{}')], ['value']);
  return { schema: z.record(z.string(), value.schema), leaves: value.leaves };
};

const aRecordWithKey: Kind = (_next, below) => {
  const key = below.leaf([suffix('{key}')], ['key']);
  const value = below.nested([suffix('{}')], ['value']);
  return {
    schema: z.record(key.schema as never, value.schema),
    leaves: [...key.leaves, ...value.leaves],
  };
};

const aUnion: Kind = (_next, below) => {
  const first = below.nested([suffix('<|0>')], ['option']);
  const second = below.nested([suffix('<|1>')], ['option']);
  return {
    schema: z.union([first.schema, second.schema]),
    leaves: [...first.leaves, ...second.leaves],
  };
};

const aVariant: Kind = (_next, below) => {
  const first = below.nested([suffix('<t="x">'), field('v')], ['variant', 'field']);
  const second = below.nested([suffix('<t="y">'), field('v')], ['variant', 'field']);
  return {
    schema: z.discriminatedUnion('t', [
      z.object({ t: z.literal('x'), v: first.schema }),
      z.object({ t: z.literal('y'), v: second.schema }),
    ]),
    leaves: [...first.leaves, ...second.leaves],
  };
};

const anIntersection: Kind = (_next, below) => {
  const first = below.nested([suffix('[0]'), field('a')], ['intersection', 'field']);
  const second = below.nested([suffix('[1]'), field('b')], ['intersection', 'field']);
  return {
    schema: z.intersection(z.object({ a: first.schema }), z.object({ b: second.schema })),
    leaves: [...first.leaves, ...second.leaves],
  };
};

const plainKinds: readonly Kind[] = [
  anObject,
  anArray,
  aTuple,
  aTupleWithRest,
  aRecord,
  aUnion,
  aVariant,
  anIntersection,
];
