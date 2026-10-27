import { describe, expect, test } from 'vitest';
import { seededNext } from '../../test/random-schemas.ts';
import { byCodePoint, canonicalTextOf, isJsonValue } from '../internal/index.ts';

/** The order of two texts by their code points, compared one by one from arrays. */
function referenceOrder(left: string, right: string): number {
  const leftPoints = Array.from(left, (char) => char.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (char) => char.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index++) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

const pieces = ['a', 'b', '/', '\u{1F600}', '\u{10000}', '\u{FFFF}', '\uD800', '\uDC00', '\uD83D'];

describe('byCodePoint', () => {
  test.for([
    ['a character above U+FFFF', '\u{FFFF}', '\u{10000}'],
    ['a shorter text that is a prefix', 'abc', 'abcd'],
    ['a lone high surrogate', '\uD800', '\u{10000}'],
    ['the empty text', '', 'a'],
  ] as const)('%s: the smaller text orders first', ([, smaller, larger]) => {
    expect(byCodePoint(smaller, larger)).toBeLessThan(0);
    expect(byCodePoint(larger, smaller)).toBeGreaterThan(0);
    expect(byCodePoint(smaller, smaller)).toBe(0);
  });

  test('texts of astral characters, lone surrogates and shared prefixes order as their code points do', () => {
    const next = seededNext(314);
    const pick = () => pieces[Math.floor(next() * pieces.length)] ?? '';
    const textOf = (length: number) => Array.from({ length }, pick).join('');
    const disagreements: string[] = [];

    for (let draw = 0; draw < 5000; draw++) {
      const prefix = textOf(Math.floor(next() * 4));
      const left = prefix + textOf(Math.floor(next() * 4));
      const right = prefix + textOf(Math.floor(next() * 4));
      if (Math.sign(byCodePoint(left, right)) !== Math.sign(referenceOrder(left, right))) {
        disagreements.push(JSON.stringify([left, right]));
      }
    }

    expect(disagreements).toEqual([]);
  });
});

/** A value as a reference writes it: keys in code point order, two-space indented, a final newline. */
function referenceTextOf(value: unknown): string {
  return `${JSON.stringify(withKeysInCodePointOrder(value), null, 2)}\n`;
}

function withKeysInCodePointOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withKeysInCodePointOrder);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const keys = Object.keys(value).sort(referenceOrder);
  return Object.fromEntries(
    keys.map((key) => [key, withKeysInCodePointOrder(Reflect.get(value, key))]),
  );
}

const keyPieces = ['a', 'b', 'Z', '_', 'é', '\u{1F600}', '\uFFFF', '"', '\\'];
const scalars = [null, true, false, 0, -1.5, 1e21, 'text', '', '\u2028', '"\\', '\u{1F600}'];

/** A random JSON value at most `depth` containers deep, its keys never integer-like. */
function aJsonValueOf(next: () => number, depth: number): unknown {
  const draw = Math.floor(next() * 4);
  if (depth === 0 || draw === 0) {
    return scalars[Math.floor(next() * scalars.length)];
  }
  const count = Math.floor(next() * 4);
  if (draw === 1) {
    return Array.from({ length: count }, () => aJsonValueOf(next, depth - 1));
  }
  const pick = () => keyPieces[Math.floor(next() * keyPieces.length)] ?? 'a';
  const entries = Array.from({ length: count }, () => [
    `${pick()}${pick()}`,
    aJsonValueOf(next, depth - 1),
  ]);
  return Object.fromEntries(entries);
}

/** `depth` containers, lists and objects in turn from a list, each holding the next, around `inner`. */
function aNestOfListsAndObjects(depth: number, inner: unknown): unknown {
  let value = inner;
  for (let level = depth - 1; level >= 0; level--) {
    value = level % 2 === 0 ? [value] : { a: value };
  }
  return value;
}

/** The canonical text of `aNestOfListsAndObjects(depth, { z: 1, a: 0 })`, written level by level. */
function nestText(depth: number): string {
  const opened: string[] = [];
  const closed: string[] = [];
  for (let level = 0; level < depth; level++) {
    const inner = '  '.repeat(level + 1);
    const isList = level % 2 === 0;
    opened.push(isList ? `[\n${inner}` : `{\n${inner}"a": `);
    closed.unshift(`\n${'  '.repeat(level)}${isList ? ']' : '}'}`);
  }
  const indent = '  '.repeat(depth);
  const innermost = `{\n${indent}  "a": 0,\n${indent}  "z": 1\n${indent}}`;
  return `${opened.join('')}${innermost}${closed.join('')}\n`;
}

describe('canonicalTextOf', () => {
  test.for([1, 2, 3])(
    'a random JSON value, seed %i, is written as its keys sorted by code point and indented',
    (seed) => {
      const next = seededNext(seed);
      const values = Array.from({ length: 200 }, () => ({ value: aJsonValueOf(next, 6) }));

      const texts = values.map((value) => canonicalTextOf(value as never));

      expect(texts).toEqual(values.map(referenceTextOf));
    },
  );

  test('a value nested 5,000 lists and objects deep is written whole, its object sorted and every line indented', () => {
    const value = aNestOfListsAndObjects(5_000, { z: 1, a: 0 });

    const text = canonicalTextOf(value as never);

    expect(text === nestText(5_000)).toBe(true);
  });
});

/** `depth` lists, each holding the next, around `inner`. */
function aNestOfLists(depth: number, inner: unknown): unknown[] {
  const outermost: unknown[] = [];
  let list = outermost;
  for (let level = 1; level < depth; level++) {
    const held: unknown[] = [];
    list.push(held);
    list = held;
  }
  list.push(inner);
  return outermost;
}

describe('isJsonValue', () => {
  test('a value nested 100,000 lists deep is JSON', () => {
    const value = aNestOfLists(100_000, { a: [1, 'b', null] });

    expect(isJsonValue(value)).toBe(true);
  });

  test.for([...Array.from({ length: 65 }, (_, depth) => depth), 10_000])(
    'a value holding itself %i lists below it is no JSON',
    (depth) => {
      const value = aNestOfLists(depth + 1, 0);
      let innermost: unknown[] = value;
      for (let level = 0; level < depth; level++) {
        innermost = innermost[0] as unknown[];
      }
      innermost.push(value);

      expect(isJsonValue(value)).toBe(false);
    },
  );

  test('a value holding one object twice, with no cycle, is JSON', () => {
    const shared = aNestOfLists(10_000, { a: 1 });

    expect(isJsonValue({ left: shared, right: [shared, shared] })).toBe(true);
  });
});
