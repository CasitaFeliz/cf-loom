import { describe, expect, test } from 'vitest';
import { seededNext } from '../../test/random-schemas.ts';
import { byCodePoint } from '../internal/index.ts';

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
