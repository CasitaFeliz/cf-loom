// biome-ignore-all lint/style/useNamingConvention: SNS spells its message attribute fields in PascalCase
import { describe, expect, test } from 'vitest';
import { growthOf } from '../../test/growth.ts';
import { seededNext } from '../../test/random-schemas.ts';
import {
  brokerHeaderBytesOf,
  isIdHeaderValue,
  maxBrokerHeaderBytes,
  receivedSnsAttributesOf,
  snsAttributeNames,
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

/** A seeded draw of strings over every range of code units, with `extraUnits` drawn as well. */
function aTextDrawing(seed: number, extraUnits: readonly string[] = []) {
  const next = seededNext(seed);
  const below = (limit: number) => Math.floor(next() * limit);
  const ranges = [
    () => String.fromCharCode(0x20 + below(0x5f)),
    () => String.fromCharCode(below(0x20)),
    () => String.fromCharCode(0x7f + below(0x21)),
    () => String.fromCharCode(0xa0 + below(0xd800 - 0xa0)),
    () => String.fromCharCode(0xe000 + below(0x2000)),
    () => String.fromCodePoint(0x10000 + below(0x100000)),
    () => ['"', '\\', ' ', '\uffff', '\ufffe'][below(5)] ?? '',
  ];
  if (extraUnits.length > 0) {
    ranges.push(() => extraUnits[below(extraUnits.length)] ?? '');
  }
  const unitOf = (): string => ranges[below(ranges.length)]?.() ?? '';
  const textOf = (): string => Array.from({ length: below(13) }, unitOf).join('');
  return { below, textOf };
}

/** A seeded draw of the Messages a Caller can give `publish`: what the core accepts, over every range of code units. */
function aDrawing(seed: number) {
  const { below, textOf } = aTextDrawing(seed);
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

/** The text of each attribute `snsAttributesOf` writes for a Message, by its name. */
function textsOf(
  message: Parameters<typeof snsAttributesOf>[0],
): Record<string, string | undefined> {
  const entries = Object.entries(snsAttributesOf(message));
  return Object.fromEntries(entries.map(([name, { StringValue }]) => [name, StringValue]));
}

/** The attributes of a received Message as SQS answers them, each of the DataType `String` with the text given; a name with no text is absent. */
function received(texts: Readonly<Record<string, string | undefined>>) {
  const attributes: Record<string, { DataType: string; StringValue: string }> = {};
  for (const [name, text] of Object.entries(texts)) {
    if (text !== undefined) {
      attributes[name] = { DataType: 'String', StringValue: text };
    }
  }
  return attributes;
}

describe('the SNS wire', () => {
  test('a Message travels in four message attributes of the DataType String, named as the wire says', () => {
    const attributes = snsAttributesOf(aMessage({ headers: { 'x-trace': 'abc' } }));

    expect(snsAttributeNames).toEqual([
      snsSubjectAttribute,
      snsMessageIdAttribute,
      snsFactIdAttribute,
      snsHeadersAttribute,
    ]);
    expect(Object.keys(attributes)).toEqual([...snsAttributeNames]);
    expect(Object.values(attributes).map(({ DataType }) => DataType)).toEqual([
      'String',
      'String',
      'String',
      'String',
    ]);
    expect(attributes[snsSubjectAttribute]?.StringValue).toBe(
      'orders-service.event.OrderCreated.v1',
    );
  });

  test.each([
    ['a Number', { DataType: 'Number', StringValue: '1' }],
    ['a String.json', { DataType: 'String.json', StringValue: '"fact-1"' }],
    ['a Binary', { DataType: 'Binary', StringValue: '"fact-1"' }],
    ['a String with no StringValue', { DataType: 'String' }],
    ['a String with an empty StringValue', { DataType: 'String', StringValue: '' }],
    ['an attribute with no DataType', { StringValue: '"fact-1"' }],
  ])('an id attribute that is %s is listed as not reading back', (_, attribute) => {
    const attributes = received(textsOf(aMessage()));

    const withMessageId = receivedSnsAttributesOf({
      ...attributes,
      [snsMessageIdAttribute]: attribute,
    });
    const withFactId = receivedSnsAttributesOf({ ...attributes, [snsFactIdAttribute]: attribute });
    const withHeaders = receivedSnsAttributesOf({
      ...attributes,
      [snsHeadersAttribute]: attribute,
    });

    expect(withMessageId).toEqual({ kind: 'missing', names: [snsMessageIdAttribute] });
    expect(withFactId).toEqual({ kind: 'missing', names: [snsFactIdAttribute] });
    expect(withHeaders).toEqual({ kind: 'missing', names: [snsHeadersAttribute] });
  });

  test('a received Message with no message attributes lists the three', () => {
    const read = receivedSnsAttributesOf(undefined);

    expect(read).toEqual({
      kind: 'missing',
      names: [snsMessageIdAttribute, snsFactIdAttribute, snsHeadersAttribute],
    });
  });
});

describe('snsAttributesOf and receivedSnsAttributesOf', () => {
  test('every Fact id, Broker message id and set of Transport headers the core accepts encodes to printable ASCII and reads back unchanged, __proto__ and constructor headers included', () => {
    const draw = aDrawing(478);
    const seen = new Set<string>();

    for (let round = 0; round < 3_000; round++) {
      const drawn = draw();
      const attributes = snsAttributesOf({ subject: 's', ...drawn });
      const read = receivedSnsAttributesOf(attributes);

      const texts = textsOf({ subject: 's', ...drawn });
      expect(texts[snsMessageIdAttribute]).toBe(referenceEncodingOf(drawn.messageId));
      expect(texts[snsFactIdAttribute]).toBe(referenceEncodingOf(drawn.factId));
      expect(texts[snsHeadersAttribute]).toBe(referenceEncodingOfHeaders(drawn.headers));
      expect(texts[snsHeadersAttribute]).toMatch(printable);
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

/** A Message as `publish` hands it to the adapter, with the given ids and headers. */
function aMessage(given: Partial<Drawn> = {}) {
  return {
    subject: 'orders-service.event.OrderCreated.v1',
    messageId: 'event.OrderCreated.v1:fact-1',
    factId: 'fact-1',
    headers: {},
    ...given,
  };
}

describe('the values snsAttributesOf writes', () => {
  test.each([
    ['empty ids and no headers', aMessage({ messageId: '', factId: '' })],
    ['astral characters and controls', aMessage({ factId: '\u{1f600}\u0001\u007f' })],
    ['a header', aMessage({ headers: { 'x-trace': 'abc' } })],
  ])('%s are written as JSON text SNS accepts, never empty', (_, message) => {
    const attributes = textsOf(message);

    for (const name of [snsMessageIdAttribute, snsFactIdAttribute, snsHeadersAttribute]) {
      const value = attributes[name] ?? '';
      expect(value).not.toBe('');
      expect(() => JSON.parse(value)).not.toThrow();
    }
  });
});

describe('receivedSnsAttributesOf', () => {
  test('a received Message lacking an id attribute lists it, and one lacking both lists both', () => {
    const attributes = textsOf(aMessage());
    const withoutMessageId = { ...attributes, [snsMessageIdAttribute]: undefined };
    const withoutFactId = { ...attributes, [snsFactIdAttribute]: undefined };
    const withoutBoth = { ...withoutMessageId, [snsFactIdAttribute]: undefined };

    expect(receivedSnsAttributesOf(received(withoutMessageId))).toEqual({
      kind: 'missing',
      names: [snsMessageIdAttribute],
    });
    expect(receivedSnsAttributesOf(received(withoutFactId))).toEqual({
      kind: 'missing',
      names: [snsFactIdAttribute],
    });
    expect(receivedSnsAttributesOf(received(withoutBoth))).toEqual({
      kind: 'missing',
      names: [snsMessageIdAttribute, snsFactIdAttribute],
    });
  });
});

describe('the ids receivedSnsAttributesOf reads', () => {
  test.each([
    ['text that is not JSON', 'fact-1'],
    ['JSON that is not a string', '42'],
    ['a JSON object', '{"id":"fact-1"}'],
    ['a JSON null', 'null'],
    ['an empty JSON string, which the Fact id’s rule refuses', '""'],
  ])('an id attribute holding %s is listed as not reading back', (_, value) => {
    const attributes = textsOf(aMessage());

    const withMessageId = receivedSnsAttributesOf(
      received({
        ...attributes,
        [snsMessageIdAttribute]: value,
      }),
    );
    const withFactId = receivedSnsAttributesOf(
      received({ ...attributes, [snsFactIdAttribute]: value }),
    );

    expect(withMessageId).toEqual({ kind: 'missing', names: [snsMessageIdAttribute] });
    expect(withFactId).toEqual({ kind: 'missing', names: [snsFactIdAttribute] });
  });

  test.each([
    ['raw non-ASCII characters', '"café \u{1f600}"', 'café \u{1f600}'],
    ['whitespace around the JSON string', ' \n\t"fact-1" \r\n', 'fact-1'],
    ['upper-case escapes', '"\\u00E9\\uD83D\\uDE00"', 'é\u{1f600}'],
  ])('an id attribute with %s reads back as the id it spells', (_, value, id) => {
    const attributes = textsOf(aMessage());

    const read = receivedSnsAttributesOf(
      received({
        ...attributes,
        [snsMessageIdAttribute]: value,
        [snsFactIdAttribute]: value,
      }),
    );

    expect(read).toEqual({ kind: 'read', messageId: id, factId: id, headers: {} });
  });
});

describe('the Transport headers receivedSnsAttributesOf reads', () => {
  test.each([
    ['missing', undefined],
    ['text that is not JSON', 'x-trace=abc'],
    ['a JSON array', '[]'],
    ['a JSON string', '"x-trace"'],
    ['a JSON null', 'null'],
    ['an object with a number', '{"x-trace":1}'],
    ['an object with a nested object', '{"x-trace":{"a":"b"}}'],
    ['an object with a null', '{"x-trace":null}'],
  ])('a cf-loom-headers that is %s is listed as not reading back', (_, value) => {
    const attributes = textsOf(aMessage());

    const read = receivedSnsAttributesOf(received({ ...attributes, [snsHeadersAttribute]: value }));

    expect(read).toEqual({ kind: 'missing', names: [snsHeadersAttribute] });
  });

  test('a message lacking its ids and its headers lists the three, in attribute order', () => {
    const read = receivedSnsAttributesOf(received({}));

    expect(read).toEqual({
      kind: 'missing',
      names: [snsMessageIdAttribute, snsFactIdAttribute, snsHeadersAttribute],
    });
  });
});

describe('the Transport headers the core would refuse', () => {
  test.each([
    ['a Cf-Loom- name', '{"Cf-Loom-Trace":"abc"}'],
    ['a Nats- name in lower case', '{"nats-msg-id":"abc"}'],
    ['a name NATS cannot carry', '{"x trace":"abc"}'],
    ['a name with a colon', '{"x:trace":"abc"}'],
    ['a value with a CR', '{"x-trace":"a\\rb"}'],
    ['a value with a LF', '{"x-trace":"a\\nb"}'],
    ['a value with whitespace at its end', '{"x-trace":"abc "}'],
    ['a value with a lone surrogate', '{"x-trace":"\\ud800"}'],
  ])('a cf-loom-headers holding %s is listed as not reading back', (_, value) => {
    const attributes = textsOf(aMessage());

    const read = receivedSnsAttributesOf(received({ ...attributes, [snsHeadersAttribute]: value }));

    expect(read).toEqual({ kind: 'missing', names: [snsHeadersAttribute] });
  });

  test('one refused header among accepted ones lists the attribute and gives no header', () => {
    const attributes = textsOf(aMessage());
    const value = '{"x-trace":"abc","Nats-Msg-Id":"abc"}';

    const read = receivedSnsAttributesOf(received({ ...attributes, [snsHeadersAttribute]: value }));

    expect(read).toEqual({ kind: 'missing', names: [snsHeadersAttribute] });
  });
});

describe('the header names every object has', () => {
  test('headers named __proto__, constructor, toString and hasOwnProperty read back as own entries', () => {
    const value =
      '{"__proto__":"a","constructor":"b","toString":"c","hasOwnProperty":"d","valueOf":"e"}';
    const attributes = textsOf(aMessage());

    const read = receivedSnsAttributesOf(received({ ...attributes, [snsHeadersAttribute]: value }));

    if (read.kind !== 'read') {
      throw new Error(`the headers did not read back: ${read.names.join(', ')}`);
    }
    expect(Object.getPrototypeOf(read.headers)).toBe(Object.prototype);
    expect(Object.entries(read.headers)).toEqual([
      ['__proto__', 'a'],
      ['constructor', 'b'],
      ['toString', 'c'],
      ['hasOwnProperty', 'd'],
      ['valueOf', 'e'],
    ]);
  });

  test('a cf-loom-headers text naming one header twice reads back with the last value, as JSON.parse keeps it', () => {
    const value = '{"x-trace":"first","x-other":"other","x-trace":"last"}';
    const attributes = textsOf(aMessage());

    const read = receivedSnsAttributesOf(received({ ...attributes, [snsHeadersAttribute]: value }));

    expect(read).toEqual({
      kind: 'read',
      messageId: 'event.OrderCreated.v1:fact-1',
      factId: 'fact-1',
      headers: { 'x-trace': 'last', 'x-other': 'other' },
    });
  });
});

/** The units a Caller's string may hold that the core refuses: CR, LF, whitespace NATS would trim, and a lone surrogate. */
const refusedUnits = ['\r', '\n', '\t', '\u00a0', '\ufeff', '\u2028', '\ud800', '\udfff'];

/** The same JSON text with its `\uXXXX` escapes in upper case, an escaped backslash kept as it is. */
function inUpperCase(json: string): string {
  return json.replace(/\\\\|\\u[0-9a-f]{4}/g, (written) =>
    written === '\\\\' ? written : `\\u${written.slice(2).toUpperCase()}`,
  );
}

/** The Broker message id an attribute of this JSON text reads back as, with everything else in order; `undefined` when it does not read back. */
function messageIdReadFrom(json: string): string | undefined {
  const read = receivedSnsAttributesOf(
    received({
      [snsMessageIdAttribute]: json,
      [snsFactIdAttribute]: '"fact-1"',
      [snsHeadersAttribute]: '{}',
    }),
  );
  return read.kind === 'read' ? read.messageId : undefined;
}

/** The value of the one header an attribute of this JSON text reads back as, with everything else in order; `undefined` when it does not read back. */
function headerValueReadFrom(json: string): string | undefined {
  const read = receivedSnsAttributesOf(
    received({
      [snsMessageIdAttribute]: '"event.E.v1:fact-1"',
      [snsFactIdAttribute]: '"fact-1"',
      [snsHeadersAttribute]: json,
    }),
  );
  return read.kind === 'read' ? Object.values(read.headers)[0] : undefined;
}

describe('what receivedSnsAttributesOf accepts', () => {
  test('is exactly what the core accepts as an id and as a header, whatever the string and its spelling', () => {
    const { below, textOf } = aTextDrawing(479, refusedUnits);
    const names = ['a', 'X-Trace', '__proto__', 'constructor', 'Cf-Loom-A', 'nats-b', 'a b', 'a:b'];
    const spellings = [JSON.stringify, (value: unknown) => inUpperCase(JSON.stringify(value))];
    const outcomes = new Set<string>();

    for (let round = 0; round < 4_000; round++) {
      const text = textOf();
      const name = names[below(names.length)] ?? '';
      const spell = spellings[round % 2] ?? JSON.stringify;
      const isId = isIdHeaderValue(text);
      const isHeader = transportHeaderFitOf(name, text) === 'travels';

      expect(messageIdReadFrom(spell(text))).toBe(isId ? text : undefined);
      expect(headerValueReadFrom(spell({ [name]: text }))).toBe(isHeader ? text : undefined);
      outcomes.add(`id accepted: ${isId}`).add(`header accepted: ${isHeader}`);
    }

    expect(outcomes.size).toBe(4);
  });
});

describe('the Broker headers of a Message received', () => {
  /** A Message whose one header takes the Broker headers to exactly `bytes`, the header holding two-byte characters but for the last, so the count is of bytes and not of characters. */
  function aMessageOfBrokerHeaderBytes(bytes: number) {
    const bare = aMessage({ headers: { 'x-pad': '' } });
    const padding = bytes - brokerHeaderBytesOf(bare);
    const pad = `${'\u00e9'.repeat(Math.floor(padding / 2))}${'a'.repeat(padding % 2)}`;
    return aMessage({ headers: { 'x-pad': pad } });
  }

  test('exactly 65,535 bytes of them read back, and one byte more lists the three attributes', () => {
    const atTheBound = aMessageOfBrokerHeaderBytes(maxBrokerHeaderBytes);
    const beyond = aMessageOfBrokerHeaderBytes(maxBrokerHeaderBytes + 1);

    const readAtTheBound = receivedSnsAttributesOf(snsAttributesOf(atTheBound));
    const readBeyond = receivedSnsAttributesOf(snsAttributesOf(beyond));

    expect(brokerHeaderBytesOf(atTheBound)).toBe(maxBrokerHeaderBytes);
    expect(readAtTheBound.kind).toBe('read');
    expect(readBeyond).toEqual({
      kind: 'missing',
      names: [snsMessageIdAttribute, snsFactIdAttribute, snsHeadersAttribute],
    });
  });
});

describe('the growth of encoding and reading SNS attributes back', () => {
  /**
   * How many times longer a shape eight times as large may take: 8 for a read that visits each part once,
   * which a large object's allocation and collection stretch to 10 to 14, and 64 for one that copies at each part.
   */
  const linearGrowth = 24;
  const growthTimeout = 240_000;
  const widths = { small: 2_000, large: 16_000 };
  const lengths = { small: 20_000, large: 160_000 };

  /** A string of `length` code units over every kind the encoding acts on. */
  function aTextOf(length: number): string {
    const unit = ['a', '\u0001', '"', '\\', '\u00e9', '\u{1f600}', ' '];
    return Array.from({ length: Math.ceil(length / 2) }, (_, at) => unit[at % unit.length])
      .join('')
      .slice(0, length);
  }

  const headersOfWidth = (width: number) =>
    Object.fromEntries(Array.from({ length: width }, (_, at) => [`h${at}`, `value ${at}`]));

  const messageOf = (headers: Readonly<Record<string, string>>) => aMessage({ headers });

  test.each([
    ['the number of headers', widths, (size: number) => messageOf(headersOfWidth(size))],
    ['one value’s length', lengths, (size: number) => messageOf({ 'x-pad': aTextOf(size) })],
  ])(
    'encoding grows linearly with %s',
    (_, sizes, aMessageOf) => {
      const encoding = (size: number) => {
        const message = aMessageOf(size);
        return () => snsAttributesOf(message);
      };

      const growth = growthOf(encoding, sizes, linearGrowth);

      expect(growth).toBeLessThan(linearGrowth);
    },
    growthTimeout,
  );

  test.each([
    ['the number of headers', widths, (size: number) => messageOf(headersOfWidth(size))],
    ['one value’s length', lengths, (size: number) => messageOf({ 'x-pad': aTextOf(size) })],
  ])(
    'reading back grows linearly with %s',
    (_, sizes, aMessageOf) => {
      const reading = (size: number) => {
        const attributes = snsAttributesOf(aMessageOf(size));
        return () => receivedSnsAttributesOf(attributes);
      };

      const growth = growthOf(reading, sizes, linearGrowth);

      expect(growth).toBeLessThan(linearGrowth);
    },
    growthTimeout,
  );
});

describe('the growth of reading foreign SNS attributes', () => {
  const linearGrowth = 24;
  const growthTimeout = 240_000;

  test(
    'an id attribute of the largest size SQS carries is read, refused or accepted, in time that grows linearly with its length',
    () => {
      const aReading = (length: number) => {
        const attributes = received({
          ...textsOf(aMessage()),
          [snsFactIdAttribute]: JSON.stringify('x'.repeat(length)),
        });
        return () => receivedSnsAttributesOf(attributes);
      };
      const nearOneMebibyte = 1_000_000;

      const accepted = aReading(30_000)();
      const refused = aReading(nearOneMebibyte)();
      const growth = growthOf(aReading, { small: 4_000, large: 32_000 }, linearGrowth);
      const growthBeyond = growthOf(
        aReading,
        { small: 125_000, large: nearOneMebibyte },
        linearGrowth,
      );

      expect(accepted.kind).toBe('read');
      expect(refused).toEqual({
        kind: 'missing',
        names: [snsMessageIdAttribute, snsFactIdAttribute, snsHeadersAttribute],
      });
      expect(growth).toBeLessThan(linearGrowth);
      expect(growthBeyond).toBeLessThan(linearGrowth);
    },
    growthTimeout,
  );

  test(
    'a cf-loom-headers nested 100,000 levels deep is listed as not reading back, in time that grows linearly with its depth',
    () => {
      const aReading = (depth: number) => {
        const nested = `${'{"a":'.repeat(depth)}"x"${'}'.repeat(depth)}`;
        const attributes = received({ ...textsOf(aMessage()), [snsHeadersAttribute]: nested });
        return () => receivedSnsAttributesOf(attributes);
      };
      const deepest = 100_000;

      const read = aReading(deepest)();
      const growth = growthOf(aReading, { small: deepest / 8, large: deepest }, linearGrowth);

      expect(read).toEqual({ kind: 'missing', names: [snsHeadersAttribute] });
      expect(growth).toBeLessThan(linearGrowth);
    },
    growthTimeout,
  );
});
