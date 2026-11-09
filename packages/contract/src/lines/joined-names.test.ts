import { describe, expect, expectTypeOf, test } from 'vitest';
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

type Closing = 'and' | 'or';

/** The text type `joinedOf` gives a list of names and a closing word. */
type TextOf<Names extends readonly string[], Word extends Closing> = ReturnType<
  typeof joinedOf<Names, Word>
>;

/** `n0` … `n<Length - 1>`, as a tuple. */
type NamesOf<Length extends number, Built extends string[] = []> = Built['length'] extends Length
  ? Built
  : NamesOf<Length, [...Built, `n${Built['length']}`]>;

/** The sentence for a tuple, written by position as `sentenceOf` writes it: nothing, `, ` or the word before each name. */
type ByPosition<
  Names extends readonly string[],
  Word extends string,
  Seen extends unknown[] = [],
  Text extends string = '',
> = Names extends readonly [infer First extends string, ...infer Rest extends readonly string[]]
  ? ByPosition<
      Rest,
      Word,
      [...Seen, First],
      `${Text}${Seen['length'] extends 0 ? '' : Rest extends readonly [] ? ` ${Word} ` : ', '}${First}`
    >
  : Text;

type Lengths = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** For each length, whether the text type and the oracle are one type. */
type Agreement<Word extends Closing> = {
  [Length in Lengths]: [TextOf<NamesOf<Length>, Word>] extends [ByPosition<NamesOf<Length>, Word>]
    ? [ByPosition<NamesOf<Length>, Word>] extends [TextOf<NamesOf<Length>, Word>]
      ? true
      : false
    : false;
};

type EveryLengthAgrees = Record<Lengths, true>;

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

  test('joinedOf types its text as the sentence a tuple of names is written as, for every length to six', () => {
    const text = joinedOf(['a', 'b', 'c'], 'and');

    expectTypeOf<Agreement<'and'>>().toEqualTypeOf<EveryLengthAgrees>();
    expectTypeOf<Agreement<'or'>>().toEqualTypeOf<EveryLengthAgrees>();
    expectTypeOf<TextOf<['a', 'b'], 'or'>>().toEqualTypeOf<'a or b'>();
    expectTypeOf<TextOf<['a'], 'and'>>().toEqualTypeOf<'a'>();
    expectTypeOf<TextOf<[], 'and'>>().toEqualTypeOf<''>();
    expectTypeOf(text).toEqualTypeOf<'a, b and c'>();
    expect(text).toBe('a, b and c');
  });
});

describe('joinedOf for a list whose length its type leaves open', () => {
  test('joinedOf types its text as string for any list that is not a tuple of known length', () => {
    expectTypeOf<TextOf<string[], 'and'>>().toEqualTypeOf<string>();
    expectTypeOf<TextOf<readonly string[], 'or'>>().toEqualTypeOf<string>();
    expectTypeOf<TextOf<['a', ...string[]], 'and'>>().toEqualTypeOf<string>();
    expectTypeOf<TextOf<[...string[], 'z'], 'and'>>().toEqualTypeOf<string>();
    expectTypeOf<TextOf<['a', ...string[], 'z'], 'and'>>().toEqualTypeOf<string>();
    // biome-ignore lint/suspicious/noExplicitAny: the any this test is about
    expectTypeOf<TextOf<any, 'and'>>().toEqualTypeOf<string>();
    expect(joinedOf(['x', 'y'].filter(Boolean), 'or')).toBe('x or y');
  });

  test('joinedOf types a variable upcast to a list of strings as string', () => {
    const upcast: readonly string[] = ['x', 'y'] as const;

    const text = joinedOf(upcast, 'or');

    expectTypeOf(text).toEqualTypeOf<string>();
    expect(text).toBe('x or y');
  });

  test('joinedOf types a union of lists as the union of their texts, and a list of names it cannot tell as string', () => {
    expectTypeOf<TextOf<['a', 'b'] | ['c'], 'and'>>().toEqualTypeOf<'a and b' | 'c'>();
    expectTypeOf<TextOf<['a', 'b'] | string[], 'and'>>().toEqualTypeOf<string>();
    expectTypeOf<TextOf<['a', 'b'] | [], 'and'>>().toEqualTypeOf<'a and b' | ''>();
    expectTypeOf<TextOf<['a' | 'b', 'c'], 'and'>>().toEqualTypeOf<'a and c' | 'b and c'>();
    expectTypeOf<TextOf<['a', 'b' | 'c'], 'or'>>().toEqualTypeOf<'a or b' | 'a or c'>();
    expectTypeOf<TextOf<['a', 'b'], 'and' | 'or'>>().toEqualTypeOf<'a and b' | 'a or b'>();
    expectTypeOf<TextOf<[string, string], 'and'>>().toEqualTypeOf<`${string} and ${string}`>();
    expectTypeOf<TextOf<never, 'and'>>().toEqualTypeOf<never>();
  });

  test('joinedOf types a tuple of two hundred names without exceeding the compiler’s depth', () => {
    type TwoHundred = NamesOf<200>;

    expectTypeOf<TextOf<TwoHundred, 'and'>>().toEqualTypeOf<ByPosition<TwoHundred, 'and'>>();
  });
});
