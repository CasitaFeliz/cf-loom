import { describe, expect, test } from 'vitest';
import { readKeyAt, readList, readPath, readSteps, readWords } from '../../test/line-reading.ts';
import { seededNext } from '../../test/random-schemas.ts';
import {
  authorPathOf,
  dottedPathOf,
  exactParamsSentence,
  joinedOf,
  kindWordsOf,
  oneProviderSentence,
  packageLabelOf,
  requiresEarlierSentence,
  type Site,
  siteTextOf,
  type Token,
  tokenOf,
  wordOf,
  wordsOf,
  writtenTextOf,
} from '../internal/index.ts';

/** The pieces a drawn text is made of: the separators of every line, the closing words and the odd. */
const pieces = [
  'a',
  '0',
  '-',
  ', ',
  ' and ',
  ' or ',
  'and',
  'or',
  '.',
  ' ',
  '"',
  '\\',
  '\n',
  '\u2028',
  '\t',
  'é',
  '\ud800',
  '{}',
  '@1.0.0',
  '""',
] as const;

type Draws = { readonly next: () => number; readonly used: Set<string> };

function textFrom({ next, used }: Draws): string {
  const count = Math.floor(next() * 8);
  let text = '';
  for (let drawn = 0; drawn < count; drawn++) {
    const piece = pieces[Math.floor(next() * pieces.length)] ?? '';
    used.add(piece);
    text += piece;
  }
  return text;
}

function textsFrom(draws: Draws, most: number): string[] {
  const count = Math.floor(draws.next() * (most + 1));
  return Array.from({ length: count }, () => textFrom(draws));
}

/** The words a value reads back as: its own text, or the words of its kind. */
function itemWordsOf(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }
  const kind = kindWordsOf(value);
  return kind === undefined ? [String(value)] : kind.split(' ');
}

const draws = (seed: number): Draws => ({ next: seededNext(seed), used: new Set() });
const drawCount = 5_000;

describe('wordOf', () => {
  test.for(['getOrder', 'svc.event.OrderCreated.v1', '@org/one@1.0.0', 'o-1', 'a:b+c~d$e_f', '12'])(
    'writes %s as itself',
    (text) => {
      expect(wordOf(text)).toBe(text);
    },
  );

  test.for([
    ['a, b', '"a, b"'],
    ['two words', '"two words"'],
    ['and', '"and"'],
    ['or', '"or"'],
    ['', '""'],
    ['a"b', '"a\\"b"'],
    ['café', '"café"'],
    ['a\nb', '"a\\nb"'],
  ])('writes %j as %s', ([text, written]) => {
    expect(wordOf(text ?? '')).toBe(written);
  });

  test('writes andromeda and order as themselves, since only the bare words close a list', () => {
    expect([wordOf('andromeda'), wordOf('order'), wordOf('and-or')]).toEqual([
      'andromeda',
      'order',
      'and-or',
    ]);
  });
});

describe('tokenOf', () => {
  test('writes a dot as JSON, since a dot separates the keys of a path', () => {
    expect([tokenOf('a.b'), tokenOf('a_b'), tokenOf('0')]).toEqual(['"a.b"', 'a_b', '0']);
  });
});

describe('dottedPathOf', () => {
  test('joins keys and positions by dots, each key as tokenOf writes it', () => {
    expect(dottedPathOf(['body', 'items', 0, 'a.b', 'c d'])).toBe('body.items.0."a.b"."c d"');
  });
});

describe('the items of a line read back', () => {
  test('a list of drawn texts reads back as the texts, for both closing words and every length to 6', () => {
    const drawn = draws(589);
    for (let draw = 0; draw < drawCount; draw++) {
      const texts = textsFrom(drawn, 6);
      const closing = drawn.next() < 0.5 ? 'and' : 'or';

      const line = joinedOf(texts.map(wordOf), closing);

      expect(readList(line), JSON.stringify(texts)).toEqual(texts.map((text) => [text]));
    }
    expect([...drawn.used].sort()).toEqual([...pieces].sort());
  });

  test('a record of drawn words reads back as the words', () => {
    const drawn = draws(590);
    for (let draw = 0; draw < drawCount; draw++) {
      const texts = textsFrom(drawn, 6).concat(textFrom(drawn));

      const line = wordsOf(texts.map(wordOf));

      expect(readWords(line), JSON.stringify(texts)).toEqual(texts);
    }
  });

  test('a list of records reads back as each record, since a record is closed by no word of its own', () => {
    const drawn = draws(591);
    for (let draw = 0; draw < drawCount; draw++) {
      const records = Array.from({ length: Math.floor(drawn.next() * 4) }, () =>
        textsFrom(drawn, 4).concat(textFrom(drawn)),
      );

      const line = joinedOf(
        records.map((record) => wordsOf(record.map(wordOf))),
        'and',
      );

      expect(readList(line), JSON.stringify(records)).toEqual(records);
    }
  });

  test('a path of drawn keys and positions reads back as String of each step', () => {
    const drawn = draws(592);
    for (let draw = 0; draw < drawCount; draw++) {
      const keys = textsFrom(drawn, 5).concat(textFrom(drawn));
      const steps = keys.map((key) => (drawn.next() < 0.3 ? Math.floor(drawn.next() * 9) : key));

      const line = dottedPathOf(steps);

      expect(readPath(line), JSON.stringify(steps)).toEqual(steps.map(String));
    }
  });

  test('a written value reads back as one item, or as the words of its kind', () => {
    const values: unknown[] = [
      ...textsFrom(draws(593), 40),
      0,
      -1.5,
      1e21,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      true,
      false,
      null,
      undefined,
      10n,
      Symbol('a, b and c'),
      () => 'a, b',
      [1, 2],
      { 'a, b': 1 },
    ];

    for (const value of values) {
      const line = joinedOf([writtenTextOf(value), writtenTextOf(value)], 'and');

      expect(readList(line), line).toEqual([itemWordsOf(value), itemWordsOf(value)]);
    }
  });
});

describe('the writers of a Token read back', () => {
  test('the name of a site reads back as its text, after the words the site writes', () => {
    const drawn = draws(594);
    const kinds = ['code', 'group', 'guard', 'subscription', 'dependency', 'export'] as const;
    const prefixes = [
      'codes.',
      'groups.',
      'guards.',
      'subscriptions.',
      'dependencies.',
      'exports.',
    ];
    for (let draw = 0; draw < drawCount; draw++) {
      const position = Math.floor(drawn.next() * kinds.length);
      const name = textFrom(drawn);
      const kind = kinds[position] ?? 'code';
      const site: Site = kind === 'code' ? { kind, code: name } : { kind, name };

      const text = siteTextOf(site);

      expect(readKeyAt(text, (prefixes[position] ?? '').length), JSON.stringify(name)).toBe(name);
    }
  });

  test('the name of an Endpoint reads back inside the parentheses after its identity', () => {
    const drawn = draws(595);
    for (let draw = 0; draw < drawCount; draw++) {
      const name = textFrom(drawn);

      const text = siteTextOf({ kind: 'endpoint', identity: 'GET /orders/{}', name });

      const prefix = 'endpoints.GET /orders/{} (';
      expect(text.startsWith(prefix) && text.endsWith(')'), JSON.stringify(name)).toBe(true);
      expect(readKeyAt(text.slice(0, -1), prefix.length), JSON.stringify(name)).toBe(name);
    }
  });

  test('the steps of an author path read back as the fields and positions they were', () => {
    const drawn = draws(596);
    for (let draw = 0; draw < drawCount; draw++) {
      const count = 1 + Math.floor(drawn.next() * 5);
      const steps = Array.from({ length: count }, () =>
        drawn.next() < 0.3 ? Math.floor(drawn.next() * 9) : textFrom(drawn),
      );

      const text = authorPathOf(
        steps.map((step) =>
          typeof step === 'number'
            ? ({ kind: 'index', index: step } as const)
            : ({ kind: 'field', name: step } as const),
        ),
      );

      expect(readSteps(text ?? ''), JSON.stringify(steps)).toEqual(steps);
    }
  });

  test('a package label reads back as one item, whatever the package.json holds', () => {
    const drawn = draws(597);
    for (let draw = 0; draw < drawCount; draw++) {
      const name = textFrom(drawn);
      const labels = [
        packageLabelOf({ kind: 'identified', packageName: name, version: '1.0.0' }),
        packageLabelOf({ kind: 'unversioned', packageName: name }),
        packageLabelOf({ kind: 'unnamed', manifest: name }),
      ];

      const line = joinedOf(labels, 'and');

      expect(readList(line), JSON.stringify(name)).toEqual([[name], [name], [name]]);
    }
  });
});

describe('the types of a line', () => {
  test('a Token, a list of Tokens, a literal and a mapped list are taken', () => {
    const token: Token = wordOf('a, b');
    const tokens: Token[] = ['a b', 'c'].map(wordOf);
    const names: string[] = ['a', 'b'];

    const lines = [
      joinedOf([token], 'and'),
      joinedOf(tokens, 'or'),
      joinedOf(['a', 'b'], 'and'),
      joinedOf(names.map(wordOf), 'and'),
      wordsOf([token, 'x', wordOf(names[0] ?? '')]),
      oneProviderSentence(['a', 'b']),
      exactParamsSentence(names.map(wordOf)),
      requiresEarlierSentence('guard', ['a']),
    ];

    expect(lines.length).toBe(8);
  });

  test('a literal tuple keeps its literal sentence', () => {
    const sentence: 'a and b' = joinedOf(['a', 'b'], 'and');
    const refused: "A Dependency lists one Provider's Endpoints: a and b" = oneProviderSentence([
      'a',
      'b',
    ]);

    expect([sentence, refused]).toHaveLength(2);
  });

  test('a wide string, a list of them and a template with a hole are refused', () => {
    const wide = 'a, b' as string;
    const wides: string[] = [wide];
    const upcast: readonly string[] = ['a'].map(wordOf);
    const braced = '{x}' as `{${string}}`;
    const either = 'a' as 'a' | string;

    const refusals = [
      // @ts-expect-error TS2322 a wide string is no Token
      joinedOf([wide], 'and'),
      // @ts-expect-error TS2345 a list of strings is no list of Tokens
      joinedOf(wides, 'and'),
      // @ts-expect-error TS2345 a list of Tokens upcast to strings is one of strings again
      joinedOf(upcast, 'and'),
      // @ts-expect-error TS2322 'a' | string is string
      joinedOf([either], 'and'),
      // @ts-expect-error TS2322 a template with a string hole holds anything
      joinedOf([braced], 'and'),
      // @ts-expect-error TS2322 a number is no text
      joinedOf([1], 'and'),
      // @ts-expect-error TS2322 a wide string is no Token
      wordsOf([wide, 'x']),
      // @ts-expect-error TS2345 a list of strings is no list of Tokens
      exactParamsSentence(wides),
      // @ts-expect-error TS2345 a list of strings is no list of Tokens
      oneProviderSentence(wides),
      // @ts-expect-error TS2345 a list of strings is no list of Tokens
      requiresEarlierSentence('guard', wides),
    ];

    expect(refusals.length).toBe(10);
  });

  test('a generic wrapper over strings is refused and one over Tokens is taken', () => {
    const overStrings = <Name extends string>(names: Name[]) =>
      // @ts-expect-error TS2345 a type parameter of string holds any string
      joinedOf(names, 'and');
    const overTokens = <Name extends Token>(names: readonly Name[]) =>
      joinedOf<readonly Token[], 'and'>(names, 'and');

    expect([overStrings(['a']), overTokens([wordOf('b')])]).toEqual(['a', 'b']);
  });
});
