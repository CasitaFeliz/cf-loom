import { describe, expect, test } from 'vitest';
import { joinedOf } from '../internal/index.ts';

const letters = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const closings = ['and', 'or'] as const;

/** The sentence for the first `length` letters, written by position: commas, then the closing word. */
function sentenceOf(length: number, closing: 'and' | 'or'): string {
  let sentence = '';
  for (let position = 0; position < length; position++) {
    if (position > 0) {
      sentence += position === length - 1 ? ` ${closing} ` : ', ';
    }
    sentence += letters[position];
  }
  return sentence;
}

describe('joinedOf', () => {
  test('joinedOf writes no name as nothing, one name alone, and more as commas closed by and or or, for every length to six', () => {
    const disagreements: string[] = [];

    for (const closing of closings) {
      for (let length = 0; length <= letters.length; length++) {
        const text = joinedOf(letters.slice(0, length), closing);
        const expected = sentenceOf(length, closing);
        if (text !== expected) {
          disagreements.push(`${length} names, ${closing}: "${text}" instead of "${expected}"`);
        }
      }
    }

    expect(disagreements).toEqual([]);
  });

  test('joinedOf writes each name as given, one holding a comma or the closing word included', () => {
    const text = joinedOf(['a, b', 'or'], 'and');

    expect(text).toBe('a, b and or');
  });
});
