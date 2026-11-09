import { describe, expect, test } from 'vitest';
import { aliasDrawOf } from '../../test/random-alias-draws.ts';
import { nodelessDefsOf } from '../../test/random-nodeless-defs.ts';
import { seededNext } from '../../test/random-schemas.ts';
import {
  type DefGraph,
  type Defs,
  defGraphOf,
  type RefNode,
  type SchemaNode,
} from '../internal/index.ts';

const aString: SchemaNode = { type: 'string' };
const anObject: SchemaNode = { type: 'object', fields: {} };

function ref(name: string, nullable = false): RefNode {
  return nullable ? { type: 'ref', name, nullable: true } : { type: 'ref', name };
}

const seeds = Array.from({ length: 300 }, (_, index) => index + 1);

/** The defs of a seed with a def deleted now and then, so some `ref`s name none, and an alias def marked nullable now and then. */
function degradedOf(defs: Defs, seed: number): Defs {
  const next = seededNext(seed * 7919 + 3);
  const kept = Object.entries(defs).filter(() => next() >= 0.1);
  const entries = kept.map(([name, def]): [string, SchemaNode] => {
    const isMarked = def.type === 'ref' && next() < 0.3;
    return [name, isMarked ? { ...def, nullable: true } : def];
  });
  return Object.fromEntries(entries);
}

/** The defs the drawn rows ask about: the node-less draws degraded, and both sides of the alias draws. */
const drawn: readonly Defs[] = seeds.flatMap((seed) => {
  const { baseline, proposed } = aliasDrawOf(seed);
  return [degradedOf(nodelessDefsOf(seed), seed), baseline.defs, proposed.defs];
});

/** Every object found by a plain search of a JSON value, which shares nothing with the walker. */
function objectsIn(value: unknown): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  const pending = [value];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next !== 'object' || next === null) {
      continue;
    }
    objects.push(next as Record<string, unknown>);
    for (const inner of Object.values(next)) {
      pending.push(inner);
    }
  }
  return objects;
}

function isRef(object: Record<string, unknown>): object is RefNode {
  return object['type'] === 'ref' && typeof object['name'] === 'string';
}

/** Every `ref` found by the same search. */
function refsIn(value: unknown): RefNode[] {
  return objectsIn(value).filter(isRef);
}

function refNamesIn(value: unknown): string[] {
  return refsIn(value).map(({ name }) => name);
}

/** Every name a Defs gives: its own keys and each name a `ref` in it names. */
function namesOf(defs: Defs): string[] {
  return [...new Set([...Object.keys(defs), ...refNamesIn(defs)])];
}

/** The nodes a seed asks about: the node of some defs, and now and then a `ref` to a name. */
function askedOf(defs: Defs, seed: number): SchemaNode[] {
  const next = seededNext(seed * 104729 + 11);
  const names = namesOf(defs);
  const nodes = Object.values(defs).filter(() => next() < 0.4);
  const refs = names.filter(() => next() < 0.2).map((name) => ref(name));
  return [...nodes, ...refs];
}

/** The defs and the names with no def that a plain search from some nodes finds, by their `ref`s. */
function foundFrom(nodes: readonly SchemaNode[], defs: Defs) {
  const held = new Set<string>();
  const unheld = new Set<string>();
  const pending: unknown[] = [...nodes];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const name of refNamesIn(next)) {
      if (!Object.hasOwn(defs, name)) {
        unheld.add(name);
      } else if (!held.has(name)) {
        held.add(name);
        pending.push(defs[name]);
      }
    }
  }
  return { held: [...held].sort(), unheld: [...unheld].sort() };
}

/** The facts a def holds in its own nodes, which the oracle and the graph are both given. */
function ownFactsOf(name: string, def: SchemaNode | undefined): string[] {
  return [def === undefined ? `${name}: no def` : `${name}: ${def.type}`];
}

/** Each name's own facts with those of every name it reaches, by a fresh search from each name. */
function closureBySearch(defs: Defs): Map<string, string[]> {
  const heldOf = (name: string) => (Object.hasOwn(defs, name) ? defs[name] : undefined);
  const closures = new Map<string, string[]>();
  for (const name of namesOf(defs)) {
    const reached = new Set([name]);
    const pending = [name];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      for (const written of refNamesIn(heldOf(next))) {
        if (!reached.has(written)) {
          reached.add(written);
          pending.push(written);
        }
      }
    }
    closures.set(name, [...reached].flatMap((held) => ownFactsOf(held, heldOf(held))).sort());
  }
  return closures;
}

/** One question to a graph, with the answer made comparable. */
type Question = { readonly key: string; readonly ask: (graph: DefGraph) => unknown };

/** Every kind of question a graph answers, asked about each name of the defs and about some nodes. */
function questionsOf(defs: Defs, seed: number): Question[] {
  const names = namesOf(defs);
  const nodes = askedOf(defs, seed);
  const closure = (graph: DefGraph) =>
    [...graph.closureFacts(ownFactsOf)].map(([name, held]) => [name, [...held].sort()]);
  return [
    ...names.map((name) => ({ key: `def ${name}`, ask: (graph: DefGraph) => graph.def(name) })),
    ...names.flatMap((name) =>
      [false, true].map((isNullable) => ({
        key: `resolved ${name} ${isNullable}`,
        ask: (graph: DefGraph) => graph.resolved(ref(name, isNullable)),
      })),
    ),
    { key: 'reached', ask: (graph) => graph.reached(nodes) },
    { key: 'closure', ask: (graph) => Object.fromEntries(closure(graph)) },
  ];
}

/** The questions in a random order, which the seed fixes. */
function shuffled<Item>(items: readonly Item[], seed: number): Item[] {
  const next = seededNext(seed * 7727 + 5);
  const rest = [...items];
  const taken: Item[] = [];
  while (rest.length > 0) {
    const [one] = rest.splice(Math.floor(next() * rest.length), 1);
    taken.push(one as Item);
  }
  return taken;
}

function answersOf(graph: DefGraph, questions: readonly Question[]) {
  return Object.fromEntries(questions.map(({ key, ask }) => [key, structuredClone(ask(graph))]));
}

/** The alias defs from a name on, and whether they come back to one already followed. */
function aliasPathOf(defs: Defs, start: string) {
  const path: string[] = [];
  for (let name = start; Object.hasOwn(defs, name); ) {
    const def = defs[name] as SchemaNode;
    if (def.type !== 'ref') {
      break;
    }
    if (path.includes(name)) {
      return { length: path.length, isLoop: true };
    }
    path.push(name);
    name = def.name;
  }
  return { length: path.length, isLoop: false };
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

/** What the drawn defs must hold for the rows above to act, each asked of one draw. */
const features: Record<string, (defs: Defs) => boolean> = {
  'a name with no def': (defs) => namesOf(defs).some((name) => !Object.hasOwn(defs, name)),
  'an alias loop': (defs) => Object.keys(defs).some((name) => aliasPathOf(defs, name).isLoop),
  'an alias chain of three': (defs) =>
    Object.keys(defs).some((name) => {
      const { length, isLoop } = aliasPathOf(defs, name);
      return !isLoop && length >= 3;
    }),
  'a nullable ref in a node': (defs) =>
    Object.values(defs)
      .filter((def) => def.type !== 'ref')
      .some((def) => refsIn(def).some((used) => used.nullable === true)),
  'a nullable alias def': (defs) =>
    Object.values(defs).some((def) => def.type === 'ref' && def.nullable === true),
  'a def named constructor': (defs) => Object.hasOwn(defs, 'constructor'),
};

describe('./internal, defGraphOf', () => {
  test.each(['constructor', 'toString', '__proto__'])(
    'a def is found under a name the defs hold as their own, never under one every object inherits: %s',
    (name) => {
      const held: Defs = Object.fromEntries([[name, aString]]);
      const inherited: Defs = {};

      const found = defGraphOf(held).def(name);
      const missing = defGraphOf(inherited).def(name);

      expect(found).toBe(aString);
      expect(missing).toBeUndefined();
    },
  );

  /** The def an alias path leads to, found by following the defs one at a time with a visited set. */
  function followed(defs: Defs, start: RefNode) {
    const visited = new Set<string>();
    let nullable = start.nullable === true;
    for (let name = start.name; ; ) {
      const def = Object.hasOwn(defs, name) ? defs[name] : undefined;
      if (def === undefined || visited.has(name)) {
        return undefined;
      }
      visited.add(name);
      if (def.type !== 'ref') {
        return { name, def, nullable };
      }
      nullable = nullable || def.nullable === true;
      name = def.name;
    }
  }

  test('a ref resolves through its alias defs to the def they lead to, as following them one by one finds it', () => {
    for (const defs of drawn) {
      const graph = defGraphOf(structuredClone(defs));
      for (const name of namesOf(defs)) {
        for (const asked of [ref(name), ref(name, true)]) {
          const resolved = graph.resolved(asked);

          expect(resolved).toEqual(followed(defs, asked));
        }
      }
    }
  });

  test.each([
    { reaches: 'an alias loop', defs: { a: ref('b'), b: ref('a') }, names: ['a', 'b'] },
    { reaches: 'an alias that names itself', defs: { a: ref('a') }, names: ['a'] },
    {
      reaches: 'an alias loop it leads into',
      defs: { a: ref('b'), b: ref('c'), c: ref('b') },
      names: ['a', 'b', 'c'],
    },
    { reaches: 'an alias to a name the defs lack', defs: { a: ref('gone') }, names: ['a', 'gone'] },
    { reaches: 'a name the defs lack', defs: { o: anObject }, names: ['gone'] },
    {
      reaches: 'a name every object inherits',
      defs: { o: anObject },
      names: ['constructor', 'toString', '__proto__'],
    },
  ])('a ref to $reaches resolves to nothing, for every name on the way', ({ defs, names }) => {
    const graph = defGraphOf(defs);

    const resolved = names.map((name) => graph.resolved(ref(name)));

    expect(resolved).toEqual(names.map(() => undefined));
  });

  test.each([
    { nullableAt: 'the ref', defs: { o: anObject }, asked: ref('o', true), isNullable: true },
    {
      nullableAt: 'an alias def on the way',
      defs: { a: ref('o', true), o: anObject },
      asked: ref('a'),
      isNullable: true,
    },
    {
      nullableAt: 'an alias def behind a plain one',
      defs: { a: ref('b'), b: ref('o', true), o: anObject },
      asked: ref('a'),
      isNullable: true,
    },
    {
      nullableAt: 'no ref on the way',
      defs: { a: ref('b'), b: ref('o'), o: anObject },
      asked: ref('a'),
      isNullable: false,
    },
  ])('a ref resolves nullable when $nullableAt is: $isNullable', ({ defs, asked, isNullable }) => {
    const resolved = defGraphOf(defs).resolved(asked);

    expect(resolved?.nullable).toBe(isNullable);
  });

  test('a nullable ref asked first leaves the answer for a plain one plain', () => {
    const graph = defGraphOf({ a: ref('b'), b: ref('o'), o: anObject });

    const nullable = graph.resolved(ref('a', true));
    const plain = graph.resolved(ref('a'));
    const behind = graph.resolved(ref('b'));

    expect([nullable?.nullable, plain?.nullable, behind?.nullable]).toEqual([true, false, false]);
  });

  test('the defs some nodes reach are those a search of their refs finds, held in code point order, and the names held by none listed apart', () => {
    for (const [index, defs] of drawn.entries()) {
      const nodes = askedOf(defs, index);
      const own = structuredClone(defs);
      const reached = defGraphOf(own).reached(nodes);
      const found = foundFrom(nodes, defs);

      expect(Object.keys(reached.held)).toEqual(found.held);
      expect(Object.entries(reached.held).filter(([name, def]) => own[name] !== def)).toEqual([]);
      expect([...reached.unheld].sort()).toEqual(found.unheld);
      expect(new Set(reached.unheld).size).toBe(reached.unheld.length);
    }
  });

  test('the defs some nodes reach are held in the code point order of their names, not of their UTF-16 units', () => {
    const astral = '\u{1F600}';
    const high = '\uFFFF';
    const defs = { [high]: aString, [astral]: aString, a: aString };

    const { held } = defGraphOf(defs).reached([ref(high), ref(astral), ref('a')]);

    expect(Object.keys(held)).toEqual(['a', high, astral]);
  });

  test('a ref to a name an object inherits is listed apart, never read as a def', () => {
    const defs = { o: { type: 'array', items: ref('toString') } } as const;
    const nodes = [ref('o'), ref('constructor'), ref('__proto__')];

    const { held, unheld } = defGraphOf(defs).reached(nodes);

    expect(Object.keys(held)).toEqual(['o']);
    expect([...unheld].sort()).toEqual(['__proto__', 'constructor', 'toString']);
  });

  test('a name that is a def is held and a name that is none is listed apart, each once, however often it is reached', () => {
    const defs = { a: ref('b'), b: { type: 'array', items: ref('a') } } as const;
    const nodes = [ref('a'), ref('a'), ref('gone'), ref('gone')];

    const { held, unheld } = defGraphOf(defs).reached(nodes);

    expect(Object.keys(held)).toEqual(['a', 'b']);
    expect(unheld).toEqual(['gone']);
  });

  test('each def’s closure facts are its own and those of every def it reaches, a name with no def counted as a def of no node', () => {
    for (const defs of drawn) {
      const facts = defGraphOf(structuredClone(defs)).closureFacts(ownFactsOf);
      const expected = closureBySearch(defs);

      expect([...facts.keys()].sort()).toEqual([...expected.keys()].sort());
      for (const [name, closure] of expected) {
        expect([...(facts.get(name) ?? [])].sort()).toEqual(closure);
      }
    }
  });

  test('a closure-fact question that throws leaves the graph answering the next one', () => {
    const defs = { a: ref('b'), b: { type: 'array', items: ref('gone') } } as const;
    const graph = defGraphOf(structuredClone(defs));
    const failing = () => {
      throw new Error('own facts failed');
    };

    expect(() => graph.closureFacts(failing)).toThrow('own facts failed');
    const facts = graph.closureFacts(ownFactsOf);

    expect(new Map([...facts].map(([name, held]) => [name, [...held].sort()]))).toEqual(
      closureBySearch(defs),
    );
  });

  test('own facts that ask the same graph while its closure facts are found get the answers a fresh graph gives', () => {
    const defs: Defs = {
      top: { type: 'object', fields: { next: { required: true, schema: ref('mid') } } },
      mid: ref('leaf'),
      leaf: { type: 'array', items: ref('top') },
    };
    const askedOf = (graph: ReturnType<typeof defGraphOf>) => (name: string) => [
      `${name}: ${graph.def(name)?.type}`,
      `${name} resolves to ${graph.resolved(ref(name))?.name}`,
      `${name} reaches ${Object.keys(graph.reached([ref(name)]).held)}`,
    ];
    const graph = defGraphOf(structuredClone(defs));
    const fresh = askedOf(defGraphOf(structuredClone(defs)));
    const own = new Map(Object.keys(defs).map((name) => [name, fresh(name)]));
    const everything = [...own.values()].flat().sort();

    const facts = graph.closureFacts(askedOf(graph));

    expect(Object.fromEntries([...facts].map(([name, held]) => [name, [...held].sort()]))).toEqual({
      top: everything,
      mid: everything,
      leaf: everything,
    });
  });

  test('a graph answers alike whatever order its questions come in', () => {
    for (const [index, defs] of drawn.entries()) {
      const questions = questionsOf(defs, index);
      const first = defGraphOf(structuredClone(defs));
      const second = defGraphOf(structuredClone(defs));

      const askedInOrder = answersOf(first, shuffled(questions, index));
      const askedInAnother = answersOf(second, shuffled(questions, index + 1));

      expect(askedInOrder).toEqual(askedInAnother);
    }
  });

  test('the drawn defs hold names with no def, alias loops and chains, nullable refs and alias defs, a def named constructor and every node type', () => {
    const drawsWith = Object.entries(features).map(([feature, holds]) => [
      feature,
      drawn.filter(holds).length,
    ]);
    const typesDrawn = new Set(
      drawn.flatMap((defs) => objectsIn(defs).map((object) => object['type'])),
    );

    expect(drawsWith.filter(([, count]) => (count as number) < 10)).toEqual([]);
    expect(Object.keys(nodeTypes).filter((type) => !typesDrawn.has(type))).toEqual([]);
  });

  test('an empty Defs, no nodes and a node with no ref reach and resolve nothing', () => {
    const graph = defGraphOf({});

    const reachedFromNone = graph.reached([]);
    const reachedFromPlain = graph.reached([aString, anObject]);
    const facts = graph.closureFacts(ownFactsOf);

    expect([reachedFromNone, reachedFromPlain]).toEqual([
      { held: {}, unheld: [] },
      { held: {}, unheld: [] },
    ]);
    expect(facts.size).toBe(0);
  });

  test('a def named __proto__ is held and resolved as any other def, never read as the prototype', () => {
    const defs: Defs = Object.fromEntries([
      ['__proto__', ref('o')],
      ['o', anObject],
    ]);
    const graph = defGraphOf(defs);

    const { held } = graph.reached([ref('__proto__')]);
    const resolved = graph.resolved(ref('__proto__'));
    const facts = graph.closureFacts(ownFactsOf);

    expect(Object.keys(held)).toEqual(['__proto__', 'o']);
    expect(resolved?.name).toBe('o');
    expect([...(facts.get('__proto__') ?? [])].sort()).toEqual(['__proto__: ref', 'o: object']);
  });

  test('the names with no def are listed in the order the nodes write them', () => {
    const defs = { d0: aString, d2: aString };
    const root: SchemaNode = {
      type: 'union',
      options: [ref('d0'), ref('d1'), ref('d2'), ref('d3')],
    };

    const { unheld } = defGraphOf(defs).reached([root]);

    expect(unheld).toEqual(['d1', 'd3']);
  });

  test('the names with no def are listed in the order the defs reached write them, one def before the next', () => {
    const items = (name: string): SchemaNode => ({ type: 'array', items: ref(name) });
    const defs = { a: items('x'), b: items('y') };
    const root: SchemaNode = { type: 'union', options: [ref('a'), ref('b')] };

    const { unheld } = defGraphOf(defs).reached([root]);

    expect(unheld).toEqual(['x', 'y']);
  });
});
