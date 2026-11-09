import { seededNext } from '../../contract/test/random-schemas.ts';

/** The characters of a drawn string: quotes, line breaks, U+2028, a backslash, a lone surrogate and ordinary ones. */
const characters = [
  'a',
  "'",
  '"',
  '`',
  '\n',
  ' ',
  '\\',
  ' ',
  'é',
  '\u0000',
  '😀',
  '\ud800',
  's',
  '0',
];

function aStringLength(next: () => number): number {
  if (next() < 0.05) {
    return 300;
  }
  return next() < 0.01 ? 12_000 : Math.floor(next() * 12);
}

/** The strings a refusal shows: mostly short, rarely 300 characters, and one in a hundred 12,000, past the 10,000 `util.inspect` shows. */
function aString(next: () => number): string {
  const length = aStringLength(next);
  return Array.from({ length }, () => characters[Math.floor(next() * characters.length)]).join('');
}

/** The primitives a setting could be given and its type refuses: strings, numbers, `-0`, `NaN`, `null`, `undefined`, bigints and symbols. */
function aPrimitive(next: () => number): unknown {
  const drawn = [
    aString(next),
    next() * 1e6 - 5e5,
    Math.floor(next() * 100),
    -0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    true,
    null,
    undefined,
    10n,
    Symbol('a\nb'),
  ];
  return drawn[Math.floor(next() * drawn.length)];
}

/** A list of up to 7 entries, one in ten of up to 129, each a list one time in five, nested up to 6 deep. */
function aList(next: () => number, depth: number): unknown[] {
  const length = Math.floor(next() * (next() < 0.1 ? 130 : 8));
  return Array.from({ length }, () =>
    depth < 5 && next() < 0.2 ? aList(next, depth + 1) : aPrimitive(next),
  );
}

/**
 * Values of the domain a setting's type has, drawn from a seed: a primitive three times in ten and
 * a list of them otherwise, so that a refusal shows what `util.inspect` prints of it.
 */
export function typedValuesOf(seed: number, count: number): readonly unknown[] {
  const next = seededNext(seed);
  return Array.from({ length: count }, () => (next() < 0.3 ? aPrimitive(next) : aList(next, 0)));
}
