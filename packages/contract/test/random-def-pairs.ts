import type { Defs, ObjectNode, RefNode, SchemaNode } from '../src/internal/index.ts';
import { type Edit, editedCopy } from './random-def-edits.ts';
import { inShapeOrder, neutralNames, neutralValues } from './random-draft.ts';
import { seededNext } from './random-schemas.ts';

/** How an export holds a def: a plain union's option, a tuple's item (with `rest` or without) or an `allOf`'s item. */
export type Wrapper = 'union' | 'tuple' | 'tuple with rest' | 'allOf';

/** The export of one def, as the Baseline holds it and as the proposed copy does. */
export type ExportPair = {
  readonly wrapper: Wrapper;
  readonly baseline: SchemaNode;
  readonly proposed: SchemaNode;
};

/**
 * A seeded graph of 2 to 7 defs, an export holding each def in a wrapper, and one edited copy of
 * it. The defs are objects, alias defs, and unions or intersections whose own options name lower
 * defs only; `ref`s inside objects, arrays, records, tuples and tagged variants name any def, so
 * cycles are common.
 */
export type DefPair = {
  readonly baseline: Defs;
  readonly proposed: Defs;
  /** By export name, `e0` for `d0`. */
  readonly exports: Readonly<Record<string, ExportPair>>;
  readonly edit: Edit;
};

type Draw = {
  readonly next: () => number;
  readonly pick: <Value>(values: readonly Value[]) => Value;
  readonly count: number;
  /** The def names, in the order of the defs. */
  readonly names: readonly string[];
};

const wrappers: readonly Wrapper[] = ['union', 'tuple', 'tuple with rest', 'allOf'];

/** The pair of graphs a seed draws, the same every run, so a failing draw can be replayed. */
export function defPairOf(seed: number): DefPair {
  const next = seededNext(seed);
  const pick = <Value>(values: readonly Value[]): Value =>
    values[Math.floor(next() * values.length)] as Value;
  const count = 2 + Math.floor(next() * 6);
  const names = Array.from({ length: count }, (_, index) =>
    index === 0 && next() < 0.1 ? 'constructor' : `d${index}`,
  );
  const draw: Draw = { next, pick, count, names };
  const indexes = names.map((_, index) => index);
  const defs = Object.fromEntries(
    indexes.map((index) => [nameAt(draw, index), defAt(draw, index)]),
  );
  const held = indexes.map((index) => {
    const wrapper = pick(wrappers);
    return { name: `e${index}`, wrapper, node: wrappedAt(draw, wrapper, index) };
  });
  const exports = Object.fromEntries(held.map(({ name, node }) => [name, node]));
  const { copy, edit } = editedCopy({ defs, exports }, seededNext(seed + 1));
  const pairs = held.map(({ name, wrapper, node }): [string, ExportPair] => {
    const proposed = copy.exports[name] as SchemaNode;
    return [name, { wrapper, baseline: node, proposed }];
  });
  return { baseline: defs, proposed: copy.defs, exports: Object.fromEntries(pairs), edit };
}

/** The name of the def at an index: `d` and the index, or `constructor` where a draw names the first so. */
function nameAt(draw: Draw, index: number): string {
  return draw.names[index] as string;
}

/** A node with the Neutral annotations drawn for it, each with `chance`. */
function annotated(draw: Draw, shape: SchemaNode, chance = 0.12): SchemaNode {
  const names = neutralNames.filter(() => draw.next() < chance);
  const notes = names.map((name) => [name, draw.pick<unknown>(neutralValues[name])]);
  return { ...shape, ...Object.fromEntries(notes) };
}

/** A `ref` as a use writes it, which may be nullable. */
function useOf(draw: Draw, name: string): RefNode {
  const nullable = draw.next() < 0.1 ? { nullable: true as const } : {};
  return { ...(annotated(draw, { type: 'ref', name }) as RefNode), ...nullable };
}

function leaf(draw: Draw): SchemaNode {
  const shapes: readonly SchemaNode[] = [
    { type: 'string' },
    { type: 'boolean' },
    { type: 'json' },
    { type: 'enum', values: ['a', 'b'], open: false },
    { type: 'number' },
    { type: 'number', min: 1 },
  ];
  return annotated(draw, draw.pick(shapes));
}

/** A node of the format; `below` bounds the defs a `ref` may name where no node would stand between it and its def. */
function inline(draw: Draw, depth: number, below: number | undefined): SchemaNode {
  if (depth >= 2 || draw.next() < 0.3) {
    const named = nameAt(draw, Math.floor(draw.next() * (below ?? draw.count)));
    return below === 0 || draw.next() < 0.5 ? leaf(draw) : useOf(draw, named);
  }
  const nested = (): SchemaNode => inline(draw, depth + 1, undefined);
  const nodeless = (): SchemaNode => inline(draw, depth + 1, below);
  const kinds: readonly (() => SchemaNode)[] = [
    () => ({ type: 'union', options: [nodeless(), nodeless()] }),
    () => ({ type: 'allOf', items: inShapeOrder([nodeless(), leaf(draw)]) }),
    () => ({ type: 'tuple', items: [nested(), nested()], ...restOf(draw, nested) }),
    () => ({ type: 'array', items: nested() }),
    () => ({ type: 'record', key: { type: 'string' }, value: nested() }),
    () => ({ type: 'object', fields: fieldsOf(draw, nested) }),
    () => ({
      type: 'tagged',
      discriminator: 'kind',
      variants: { '"a"': variantOf(draw, nested) },
    }),
  ];
  return annotated(draw, draw.pick(kinds)());
}

function restOf(draw: Draw, inner: () => SchemaNode): { readonly rest?: SchemaNode } {
  return draw.next() < 0.3 ? { rest: inner() } : {};
}

function fieldsOf(draw: Draw, inner: () => SchemaNode) {
  return {
    a: { required: draw.next() < 0.5, schema: inner() },
    b: { required: draw.next() < 0.5, schema: inner() },
  };
}

function variantOf(draw: Draw, inner: () => SchemaNode): ObjectNode {
  const tag = { required: true, schema: { type: 'enum', values: ['a'], open: false } } as const;
  return { type: 'object', fields: { kind: tag, ...fieldsOf(draw, inner) } };
}

/** A def: an alias of a lower def, a union or intersection naming lower defs, or an object. */
function defAt(draw: Draw, index: number): SchemaNode {
  const roll = draw.next();
  if (index > 0 && roll < 0.2) {
    const lower = nameAt(draw, Math.floor(draw.next() * index));
    return annotated(draw, { type: 'ref', name: lower }, 0.35);
  }
  if (roll < 0.4) {
    const own = [inline(draw, 1, index), { type: 'boolean' } as const];
    const shape: SchemaNode =
      draw.next() < 0.5
        ? { type: 'union', options: own }
        : { type: 'allOf', items: inShapeOrder(own) };
    return annotated(draw, shape, 0.35);
  }
  return annotated(
    draw,
    { type: 'object', fields: fieldsOf(draw, () => inline(draw, 1, undefined)) },
    0.35,
  );
}

/** The export of a def: the def's `ref` and one more node, held as the wrapper holds its parts. */
function wrappedAt(draw: Draw, wrapper: Wrapper, index: number): SchemaNode {
  const held = useOf(draw, nameAt(draw, index));
  const other: SchemaNode =
    wrapper.startsWith('tuple') && draw.next() < 0.3
      ? { type: 'enum', values: ['a', 'b'], open: true }
      : inline(draw, 0, undefined);
  const parts = draw.next() < 0.5 ? [held, other] : [other, held];
  const shape = shapeOfWrapper(draw, wrapper, parts);
  return {
    ...annotated(draw, shape, 0.3),
    ...(draw.next() < 0.1 ? { nullable: true as const } : {}),
  };
}

function shapeOfWrapper(draw: Draw, wrapper: Wrapper, parts: SchemaNode[]): SchemaNode {
  switch (wrapper) {
    case 'union':
      return { type: 'union', options: parts };
    case 'allOf':
      return { type: 'allOf', items: inShapeOrder(parts) };
    case 'tuple':
      return { type: 'tuple', items: parts };
    case 'tuple with rest':
      return { type: 'tuple', items: parts, rest: inline(draw, 1, undefined) };
  }
}
