import { describe, expect, test } from 'vitest';
import { seededNext } from '../../test/random-schemas.ts';
import {
  isIdHeaderValue,
  receivedSnsAttributesOf,
  snsAttributesOf,
  snsFactIdAttribute,
  snsHeadersAttribute,
  snsMessageIdAttribute,
  snsSubjectAttribute,
  transportHeaderFitOf,
} from '../internal/index.ts';

const attributeNames = [
  snsSubjectAttribute,
  snsMessageIdAttribute,
  snsFactIdAttribute,
  snsHeadersAttribute,
];

const snsAttributeName = /^(?!(?:aws|amazon)\.)[A-Za-z0-9._-]{1,256}$/i;

describe('the SNS message attribute names', () => {
  test.each(attributeNames)('%s is a name SNS accepts for a message attribute', (name) => {
    expect(name).toMatch(snsAttributeName);
  });

  test('the four names are distinct', () => {
    expect(new Set(attributeNames).size).toBe(attributeNames.length);
  });
});

const shortEscapes = new Map([
  [0x22, '\\"'],
  [0x5c, '\\\\'],
  [0x08, '\\b'],
  [0x0c, '\\f'],
  [0x0a, '\\n'],
  [0x0d, '\\r'],
  [0x09, '\\t'],
]);

/** The reference encoding of a string, one code unit at a time and independent of `JSON.stringify`: JSON's escapes, printable ASCII as is, every other code unit as a lower-case `\uXXXX`. */
function referenceEncodingOf(text: string): string {
  let encoded = '"';
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    const isPrintable = unit >= 0x20 && unit <= 0x7e;
    const written = isPrintable ? text.charAt(index) : `\\u${unit.toString(16).padStart(4, '0')}`;
    encoded += shortEscapes.get(unit) ?? written;
  }
  return `${encoded}"`;
}

function referenceEncodingOfHeaders(headers: Readonly<Record<string, string>>): string {
  const entries = Object.entries(headers).map(
    ([name, value]) => `${referenceEncodingOf(name)}:${referenceEncodingOf(value)}`,
  );
  return `{${entries.join(',')}}`;
}

type Drawn = {
  readonly messageId: string;
  readonly factId: string;
  readonly headers: Readonly<Record<string, string>>;
};

/** A seeded draw of strings over every range of code units, and of the Messages a Caller can give `publish`. */
function aDrawing(seed: number) {
  const next = seededNext(seed);
  const below = (limit: number) => Math.floor(next() * limit);
  const unitOf = (): string => {
    const ranges = [
      () => String.fromCharCode(0x20 + below(0x5f)),
      () => String.fromCharCode(below(0x20)),
      () => String.fromCharCode(0x7f + below(0x21)),
      () => String.fromCharCode(0xa0 + below(0xd800 - 0xa0)),
      () => String.fromCharCode(0xe000 + below(0x2000)),
      () => String.fromCodePoint(0x10000 + below(0x100000)),
      () => ['"', '\\', ' ', '\uffff', '\ufffe'][below(5)] ?? '',
    ];
    return ranges[below(ranges.length)]?.() ?? '';
  };
  const textOf = (): string => Array.from({ length: below(13) }, unitOf).join('');
  const idOf = (): string => {
    for (;;) {
      const text = textOf();
      if (isIdHeaderValue(text)) {
        return text;
      }
    }
  };
  const names = ['a', 'A', 'x-trace', 'X-Trace', '__proto__', 'constructor', 'toString', 'b'];
  const headersOf = (): Readonly<Record<string, string>> => {
    const chosen = names.filter(() => below(3) === 0).slice(0, below(6));
    const entries: [string, string][] = [];
    for (const name of chosen) {
      const value = textOf();
      if (transportHeaderFitOf(name, value) === 'travels') {
        entries.push([name, value]);
      }
    }
    return Object.fromEntries(entries);
  };
  return (): Drawn => ({ messageId: idOf(), factId: idOf(), headers: headersOf() });
}

const printable = /^[\x20-\x7e]+$/;

describe('snsAttributesOf and receivedSnsAttributesOf', () => {
  test('every Fact id, Broker message id and set of Transport headers the core accepts encodes to printable ASCII and reads back unchanged, __proto__ and constructor headers included', () => {
    const draw = aDrawing(478);
    const seen = new Set<string>();

    for (let round = 0; round < 3_000; round++) {
      const drawn = draw();
      const attributes = snsAttributesOf({ subject: 's', ...drawn });
      const read = receivedSnsAttributesOf(attributes);

      expect(attributes[snsMessageIdAttribute]).toBe(referenceEncodingOf(drawn.messageId));
      expect(attributes[snsFactIdAttribute]).toBe(referenceEncodingOf(drawn.factId));
      expect(attributes[snsHeadersAttribute]).toBe(referenceEncodingOfHeaders(drawn.headers));
      expect(attributes[snsHeadersAttribute]).toMatch(printable);
      expect(read.kind).toBe('read');
      if (read.kind === 'read') {
        expect(read.messageId).toBe(drawn.messageId);
        expect(read.factId).toBe(drawn.factId);
        expect(Object.entries(read.headers)).toEqual(Object.entries(drawn.headers));
      }
      for (const text of [drawn.messageId, drawn.factId, ...Object.values(drawn.headers)]) {
        for (let index = 0; index < text.length; index++) {
          seen.add(kindOfUnit(text.charCodeAt(index)));
        }
      }
    }

    expect([...seen].sort()).toEqual(allKindsOfUnit);
  });
});

const controlKinds = Array.from({ length: 0x20 }, (_, code) => `control-${code}`).filter(
  (kind) => kind !== 'control-10' && kind !== 'control-13',
);

const allKindsOfUnit = [
  ...controlKinds,
  'astral-half',
  'backslash',
  'beyond-ascii',
  'delete',
  'printable',
  'quote',
].sort();

/** The kind of code unit the encoding acts on. */
function kindOfUnit(unit: number): string {
  if (unit < 0x20) {
    return `control-${unit}`;
  }
  if (unit === 0x22) {
    return 'quote';
  }
  if (unit === 0x5c) {
    return 'backslash';
  }
  if (unit < 0x7f) {
    return 'printable';
  }
  if (unit === 0x7f) {
    return 'delete';
  }
  return unit >= 0xd800 && unit <= 0xdfff ? 'astral-half' : 'beyond-ascii';
}
