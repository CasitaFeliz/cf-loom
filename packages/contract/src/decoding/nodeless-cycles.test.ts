import { describe, expect, test } from 'vitest';
import { orderOf, orders } from '../../test/growth.ts';
import { nodesIn } from '../../test/random-draft.ts';
import { nodelessDefsOf } from '../../test/random-nodeless-defs.ts';
import { publishedAt, schemaExports } from '../../test/snapshots.ts';
import {
  canonicalTextOf,
  type Defs,
  decodeSnapshot,
  type PublishedDefinitionsSnapshot,
  type SchemaNode,
} from '../internal/index.ts';

const emptyPart = { type: 'object', fields: {} } as const;
const standardCode = { origin: 'standard', headers: emptyPart } as const;
const invalidInput = 'INVALID_INPUT';
const notFound = 'NOT_FOUND';
const notImplemented = 'NOT_IMPLEMENTED';

/** The text of a Definitions Package's Snapshot holding the defs, which exports every one of them so none is unused. */
function textOf(defs: Defs): string {
  const exported = Object.keys(defs).map((name, index) => [`e${index}`, { type: 'ref', name }]);
  const snapshot: PublishedDefinitionsSnapshot = {
    format: 1,
    kind: 'definitions',
    name: '@org/definitions',
    ...publishedAt('1.0.0'),
    standardRejections: { invalidInput, notFound, notImplemented },
    guards: {},
    codes: {
      [invalidInput]: { ...standardCode, status: 400, message: 'Invalid', body: emptyPart },
      [notFound]: { ...standardCode, status: 404, message: 'Not found', body: null },
      [notImplemented]: { ...standardCode, status: 501, message: 'No', body: null },
    },
    defs,
    exports: schemaExports(Object.fromEntries(exported)),
  };
  return canonicalTextOf(snapshot);
}

type Node = {
  readonly type?: unknown;
  readonly name?: unknown;
  readonly nullable?: unknown;
  readonly options?: unknown;
  readonly items?: unknown;
};

/** A `ref` met with no node between, and what stood between the def and it. */
type Edge = {
  readonly name: string;
  readonly nullable: boolean;
  readonly viaAllOf: boolean;
  readonly nested: boolean;
};

type Step = { readonly node: Node; readonly compositions: number; readonly viaAllOf: boolean };

/**
 * The oracle, written from SNAPSHOT.md's words alone and sharing nothing with `src/`: the `ref`s a
 * def's node meets through union options and allOf items, and nothing else.
 */
function edgesOf(def: Node): Edge[] {
  const edges: Edge[] = [];
  const pending: Step[] = [{ node: def, compositions: 0, viaAllOf: false }];
  for (let step = pending.pop(); step !== undefined; step = pending.pop()) {
    const { node, compositions, viaAllOf } = step;
    if (node.type === 'ref') {
      edges.push({
        name: String(node.name),
        nullable: node.nullable === true,
        viaAllOf,
        nested: compositions >= 2,
      });
    }
    for (const child of partsOf(node)) {
      const next = { node: child, compositions: compositions + 1 };
      pending.push({ ...next, viaAllOf: viaAllOf || node.type === 'allOf' });
    }
  }
  return edges;
}

/** The nodes a node steps to with no node between: a union's options or an allOf's items. */
function partsOf(node: Node): Node[] {
  if (node.type === 'union') {
    return node.options as Node[];
  }
  return node.type === 'allOf' ? (node.items as Node[]) : [];
}

/** The defs a walk from a def's node meets a `ref` to, through the `ref`s it meets. */
function metFrom(name: string, edgesByDef: ReadonlyMap<string, readonly Edge[]>): Set<string> {
  const met = new Set<string>();
  const pending = [name];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const edge of edgesByDef.get(next) ?? []) {
      if (!met.has(edge.name)) {
        met.add(edge.name);
        pending.push(edge.name);
      }
    }
  }
  return met;
}

/** The def names, in the order the decoder reads them: code point order. */
function namesOf(defs: Defs): string[] {
  return Object.keys(defs).sort();
}

/** A graph's edges by def, and the defs each def meets, read by the oracle. */
function readOf(defs: Defs) {
  const edgesByDef = new Map(
    Object.entries(defs).map(([name, def]): [string, Edge[]] => [name, edgesOf(def)]),
  );
  const met = new Map(
    namesOf(defs).map((name): [string, Set<string>] => [name, metFrom(name, edgesByDef)]),
  );
  const leadingBack = namesOf(defs).filter((name) => met.get(name)?.has(name));
  return { edgesByDef, met, leadingBack };
}

type Read = ReturnType<typeof readOf>;

/** The defs on the same nodeless cycles as a def: those it meets that meet it, and itself. */
function groupOf(name: string, { met }: Read): string[] {
  const together = [...(met.get(name) ?? [])].filter((other) => met.get(other)?.has(name));
  return [...new Set([name, ...together])];
}

/** The edges that lie on a cycle: an edge to a def that meets its own def, or to the def itself. */
function cycleEdgesOf(defs: Defs, read: Read): { from: string; edge: Edge }[] {
  const found: { from: string; edge: Edge }[] = [];
  for (const name of namesOf(defs)) {
    for (const edge of read.edgesByDef.get(name) ?? []) {
      if (edge.name === name || read.met.get(edge.name)?.has(name)) {
        found.push({ from: name, edge });
      }
    }
  }
  return found;
}

/** What a graph holds that the generator is asserted to draw often. */
const features = [
  'a cycle of one def',
  'a cycle of two defs',
  'a cycle of three or more defs',
  'a cycle through an allOf',
  'a cycle through a nested union or allOf',
  'a cycle through a nullable ref',
  'a def on two nodeless cycles',
  'a def that reaches a nodeless cycle without lying on it',
  'an array or tuple def naming itself, in a graph with no nodeless cycle',
  'no nodeless cycle',
] as const;

type Feature = (typeof features)[number];

function featuresOf(defs: Defs): Set<Feature> {
  const read = readOf(defs);
  const onCycle = new Set(read.leadingBack);
  const sizes = read.leadingBack.map((name) => groupOf(name, read).length);
  const cycleEdges = cycleEdgesOf(defs, read);
  const targetsOf = (name: string) =>
    new Set(cycleEdges.filter(({ from }) => from === name).map(({ edge }) => edge.name));
  const found = new Map<Feature, boolean>([
    ['a cycle of one def', sizes.includes(1)],
    ['a cycle of two defs', sizes.includes(2)],
    ['a cycle of three or more defs', sizes.some((size) => size >= 3)],
    ['a cycle through an allOf', cycleEdges.some(({ edge }) => edge.viaAllOf)],
    ['a cycle through a nested union or allOf', cycleEdges.some(({ edge }) => edge.nested)],
    ['a cycle through a nullable ref', cycleEdges.some(({ edge }) => edge.nullable)],
    ['a def on two nodeless cycles', read.leadingBack.some((name) => targetsOf(name).size >= 2)],
    [
      'a def that reaches a nodeless cycle without lying on it',
      namesOf(defs).some(
        (name) =>
          !onCycle.has(name) && [...(read.met.get(name) ?? [])].some((met) => onCycle.has(met)),
      ),
    ],
    [
      'an array or tuple def naming itself, in a graph with no nodeless cycle',
      onCycle.size === 0 && namesOf(defs).some((name) => namesItself(name, defs[name])),
    ],
    ['no nodeless cycle', onCycle.size === 0],
  ]);
  return new Set([...found].filter(([, held]) => held).map(([feature]) => feature));
}

function namesItself(name: string, def: SchemaNode | undefined): boolean {
  const holdsAnother = def?.type === 'array' || def?.type === 'tuple';
  return holdsAnother && nodesIn(def).some((node) => node.type === 'ref' && node.name === name);
}

const nodeTypes = {
  string: true,
  number: true,
  boolean: true,
  enum: true,
  object: true,
  record: true,
  array: true,
  tuple: true,
  union: true,
  tagged: true,
  allOf: true,
  json: true,
  ref: true,
} as const satisfies Record<SchemaNode['type'], true>;

const reason = 'leads back to itself through refs, unions and allOfs alone';
const seeds = Array.from({ length: 3_000 }, (_, index) => index + 1);
const graphs = seeds.map((seed) => ({ seed, defs: nodelessDefsOf(seed) }));

describe('decodeSnapshot, the defs that lead back to themselves with no node between, over seeded def graphs', () => {
  test('the generator draws defs of every node type, every cycle kind, defs that only reach a cycle, cycles through a node, and graphs with none', () => {
    const typesDrawn = new Set(
      graphs.flatMap(({ defs }) => Object.values(defs).map(({ type }) => type)),
    );
    const counts = new Map(features.map((feature) => [feature, 0]));
    for (const { defs } of graphs) {
      for (const feature of featuresOf(defs)) {
        counts.set(feature, (counts.get(feature) ?? 0) + 1);
      }
    }

    const rare = [...counts].filter(([, count]) => count < 100);
    expect([...typesDrawn].sort()).toEqual(Object.keys(nodeTypes).sort());
    expect(rare).toEqual([]);
  });

  test('a Snapshot is malformed at the first def, in its order, that leads back to itself through refs, unions and allOfs alone, and decodes when none does', () => {
    const outcomes = graphs.map(({ seed, defs }) => {
      const { leadingBack } = readOf(defs);
      const decoded = decodeSnapshot(textOf(defs));
      const expected =
        leadingBack[0] === undefined
          ? { kind: 'decoded' }
          : { kind: 'malformed', at: ['defs', leadingBack[0]], reason };
      const actual =
        decoded.kind === 'malformed'
          ? { kind: decoded.kind, at: decoded.at, reason: decoded.reason }
          : { kind: decoded.kind };
      return { seed, expected, actual };
    });

    const mismatched = outcomes.filter(
      ({ expected, actual }) => JSON.stringify(expected) !== JSON.stringify(actual),
    );
    expect(mismatched.slice(0, 3)).toEqual([]);
  });
});

describe('decodeSnapshot, many defs', () => {
  const sizes = { small: 2_000, large: 16_000 };

  /** A growth test times its shape many times over, which a CI runner that several runs share stretches several times over. */
  const growthTimeout = 240_000;

  const ref = (name: string): SchemaNode => ({ type: 'ref', name });

  /** An object that holds `name` back in an optional field, so the def `name` lies on a cycle through a node. */
  const holdingBack = (name: string): SchemaNode => ({
    type: 'object',
    fields: { self: { required: false, schema: ref(name) } },
  });

  /** `count` defs named `link0`, `link1` and so on, each what `linkOf` makes of its index. */
  function aChainOf(count: number, linkOf: (index: number) => SchemaNode): Defs {
    const entries = Array.from({ length: count }, (_, index): [string, SchemaNode] => [
      `link${index}`,
      linkOf(index),
    ]);
    return Object.fromEntries(entries);
  }

  function decodedOrder(defsOf: (count: number) => Defs) {
    const prepare = (count: number) => {
      const text = textOf(defsOf(count));
      return () => decodeSnapshot(text);
    };
    const decoded = prepare(sizes.large)();
    const order = orderOf(prepare, sizes, orders.linear);
    return { decoded, order };
  }

  test('many union defs, each naming the head of one chain of alias defs, are decoded in time that grows with their number and the chain’s length', {
    timeout: growthTimeout,
  }, () => {
    const unionsNamingTheChainHead = (count: number): Defs => {
      const chain = aChainOf(count, (index) =>
        index === 0 ? holdingBack('link0') : ref(`link${index - 1}`),
      );
      const unions = Array.from({ length: count }, (_, index): [string, SchemaNode] => [
        `union${index}`,
        { type: 'union', options: [ref(`link${count - 1}`), { type: 'boolean' }] },
      ]);
      return { ...chain, ...Object.fromEntries(unions) };
    };

    const { decoded, order } = decodedOrder(unionsNamingTheChainHead);

    expect(decoded.kind).toBe('decoded');
    expect(order).toBeLessThan(orders.linear);
  });
});
