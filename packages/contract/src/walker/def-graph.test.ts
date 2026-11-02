import { describe, expect, test } from 'vitest';
import { aliasDrawOf } from '../../test/random-alias-draws.ts';
import { nodelessDefsOf } from '../../test/random-nodeless-defs.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { type Defs, defGraphOf, type RefNode, type SchemaNode } from '../internal/index.ts';

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

/** Every `ref` name found by a plain search of a JSON value, which shares nothing with the walker. */
function refNamesIn(value: unknown): string[] {
  const names: string[] = [];
  const pending = [value];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next !== 'object' || next === null) {
      continue;
    }
    const record = next as { readonly type?: unknown; readonly name?: unknown };
    if (record.type === 'ref' && typeof record.name === 'string') {
      names.push(record.name);
    }
    for (const inner of Object.values(next)) {
      pending.push(inner);
    }
  }
  return names;
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
});
