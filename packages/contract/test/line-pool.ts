import { lineBreaks } from './line-breaks.ts';
import { seededNext } from './random-schemas.ts';

const breakCodes = lineBreaks.map(([, code]) => code);

/** The characters the pool draws from beside the line breaks: ordinary, odd and not a break. */
const otherCodes = [
  ...Array.from('aZ0_@/$-." \t\\é😀', (character) => character.codePointAt(0) ?? 0),
  0xd800,
];

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
