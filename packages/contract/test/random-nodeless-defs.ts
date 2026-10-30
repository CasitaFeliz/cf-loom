import type { Defs, ObjectNode, RefNode, SchemaNode } from '../src/internal/index.ts';
import { drawFrom, inShapeOrder, type Next } from './random-draft.ts';
import { seededNext } from './random-schemas.ts';

/** What a draw is made from: the sequence of numbers, and the names of the defs a `ref` may name. */
type Draw = { readonly next: Next; readonly names: readonly string[] };

type Maker = (draw: Draw) => SchemaNode;

/** A `ref` to any def of the graph, itself included, which may be nullable where a node stands around it. */
function useOf(draw: Draw): RefNode {
  const name = drawFrom(draw.names, draw.next);
  return draw.next() < 0.15 ? { type: 'ref', name, nullable: true } : { type: 'ref', name };
}

function leafOf(draw: Draw): SchemaNode {
  const leaves: readonly SchemaNode[] = [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'json' },
    { type: 'enum', values: ['a', 'b'], open: false },
  ];
  return drawFrom(leaves, draw.next);
}

/** What stands in a field, an item or a value: a node always lies between it and the def it names. */
function memberOf(draw: Draw): SchemaNode {
  return draw.next() < 0.6 ? useOf(draw) : leafOf(draw);
}

/** The options of a union or the items of an intersection, a node standing in each at `depth`. */
function stepsOf(draw: Draw, depth: number): SchemaNode[] {
  const count = 2 + Math.floor(draw.next() * 2);
  return Array.from({ length: count }, () => stepOf(draw, depth));
}

function unionOf(draw: Draw, depth: number): SchemaNode {
  return { type: 'union', options: stepsOf(draw, depth) };
}

function allOfOf(draw: Draw, depth: number): SchemaNode {
  return { type: 'allOf', items: inShapeOrder(stepsOf(draw, depth).slice(0, 2)) };
}

/** A union or intersection inside another, which may be nullable. */
function nestedOf(draw: Draw, depth: number): SchemaNode {
  const shape = draw.next() < 0.5 ? unionOf(draw, depth + 1) : allOfOf(draw, depth + 1);
  return draw.next() < 0.1 ? { ...shape, nullable: true } : shape;
}

/** What stands in a union's option or an intersection's item: no node need lie between it and its def. */
function stepOf(draw: Draw, depth: number): SchemaNode {
  const roll = draw.next();
  if (roll < 0.7) {
    return useOf(draw);
  }
  return roll < 0.85 || depth >= 3 ? leafOf(draw) : nestedOf(draw, depth);
}

function variantOf(draw: Draw): ObjectNode | RefNode {
  if (draw.next() < 0.2) {
    return useOf(draw);
  }
  const tag = { required: true, schema: { type: 'enum', values: ['a'], open: false } } as const;
  return { type: 'object', fields: { kind: tag, a: { required: true, schema: memberOf(draw) } } };
}

/** How each node type is drawn as a def; a type added later fails to compile until it is drawn. */
const makers = {
  string: () => ({ type: 'string' }),
  number: () => ({ type: 'number' }),
  boolean: () => ({ type: 'boolean' }),
  enum: () => ({ type: 'enum', values: ['a', 'b'], open: false }),
  json: () => ({ type: 'json' }),
  object: (draw) => ({
    type: 'object',
    fields: {
      a: { required: true, schema: memberOf(draw) },
      b: { required: draw.next() < 0.5, schema: memberOf(draw) },
    },
  }),
  record: (draw) => ({ type: 'record', key: { type: 'string' }, value: memberOf(draw) }),
  array: (draw) => ({ type: 'array', items: memberOf(draw) }),
  tuple: (draw) => ({
    type: 'tuple',
    items: [memberOf(draw), memberOf(draw)],
    ...(draw.next() < 0.4 ? { rest: memberOf(draw) } : {}),
  }),
  tagged: (draw) => ({
    type: 'tagged',
    discriminator: 'kind',
    variants: { '"a"': variantOf(draw), '"b"': variantOf(draw) },
  }),
  union: (draw) => unionOf(draw, 1),
  allOf: (draw) => allOfOf(draw, 1),
  ref: (draw) => ({ type: 'ref', name: drawFrom(draw.names, draw.next) }),
} as const satisfies Record<SchemaNode['type'], Maker>;

/** The node types a def is drawn of, those that step with no node between twice as often as the rest. */
const defTypes: readonly SchemaNode['type'][] = [
  ...(Object.keys(makers) as SchemaNode['type'][]),
  'ref',
  'union',
  'allOf',
  'union',
];

/** The defs a seed draws: 2 to 8, of every node type, whose `ref`s name any of them; the same every run. */
export function nodelessDefsOf(seed: number): Defs {
  const next = seededNext(seed);
  const count = 2 + Math.floor(next() * 7);
  const names = Array.from({ length: count }, (_, index) =>
    index === 0 && next() < 0.1 ? 'constructor' : `d${index}`,
  );
  const draw: Draw = { next, names };
  const entries = names.map((name): [string, SchemaNode] => {
    const type = drawFrom(defTypes, next);
    return [name, makers[type](draw)];
  });
  return Object.fromEntries(entries);
}
