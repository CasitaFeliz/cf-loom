import { seededNext } from './random-schemas.ts';

/** The code points of the ten characters a reader may end a line at, spelled here on purpose, apart from the code under test. */
const breakCodes = [0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029];

/** The characters the pool draws from beside the line breaks: ordinary, odd and not a break. */
const otherCodes = [
  ...Array.from('aZ0_@/$-." \t\\é😀', (character) => character.codePointAt(0) ?? 0),
  0xd800,
];

/** How many characters of `text` are one of the ten line breaks. */
export function lineBreaksIn(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (breakCodes.includes(text.charCodeAt(index))) {
      count++;
    }
  }
  return count;
}

/** The texts a line is written from: each break alone and between letters, the names an object has, a long one, and 200 drawn. */
export function linePool(): readonly string[] {
  const characters = breakCodes.map((code) => String.fromCharCode(code));
  const crLf = String.fromCharCode(0x0d, 0x0a);
  const breaks = [...characters, crLf];
  return [
    '',
    ...breaks,
    ...breaks.map((lineBreak) => `a${lineBreak}b`),
    '\\n',
    '__proto__',
    'constructor',
    'toString',
    'a\n'.repeat(5_000),
    ...drawnTexts(200),
  ];
}

function drawnTexts(count: number): string[] {
  const next = seededNext(511);
  const codes = [...breakCodes, ...otherCodes];
  return Array.from({ length: count }, () => {
    const length = Math.floor(next() * 13);
    const drawn = Array.from({ length }, () => codes[Math.floor(next() * codes.length)] ?? 0);
    return String.fromCodePoint(...drawn);
  });
}
