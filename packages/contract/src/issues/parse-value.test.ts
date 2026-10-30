import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { openEnumReader } from '../index.ts';
import { encodedValueOf, parseValue, readWith } from '../internal/index.ts';

const order = z.object({ id: z.uuid(), lines: z.array(z.object({ quantity: z.int().min(1) })) });

const tree: z.ZodType = z.object({
  get next() {
    return tree.optional();
  },
});

const nestedTooDeeply = {
  path: [],
  code: 'malformed',
  message: 'The value is nested too deeply to read',
} as const;

/** A value `depth` levels deep, as a recursive object or as nested lists. */
function nestedTo(depth: number, wrap: (inner: unknown) => unknown): unknown {
  let value: unknown = {};
  for (let level = 0; level < depth; level += 1) {
    value = wrap(value);
  }
  return value;
}

const asObject = (inner: unknown): unknown => ({ next: inner });
const asList = (inner: unknown): unknown => [inner];

/** A seeded generator of the same sequence every run, so a failing draw can be replayed. */
function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const withHole = Array.of<string>();
withHole[1] = 'second';

class Row {
  readonly id = 'r-1';
}

class Priced {
  get total(): unknown {
    return 'three';
  }
}

/** Each kind of input `isAbsentAt` tells apart, with a schema that points an issue at it. */
const absenceRows: readonly (readonly [string, z.ZodType, unknown])[] = [
  ['a key held with a value of the wrong type', z.object({ a: z.string() }), { a: 1 }],
  ['a key the object lacks', z.object({ a: z.string() }), {}],
  ['a key only the prototype has', z.object({ a: z.number() }), Object.create({ a: 'x' })],
  ['a key below a key the object lacks', z.object({ in: z.object({ a: z.string() }) }), {}],
  ['a key written as undefined', z.object({ a: z.string() }), { a: undefined }],
  ['a key written as null', z.object({ a: z.string() }), { a: null }],
  ['a record key written as undefined', z.record(z.string(), z.string()), { a: undefined }],
  [
    'a key written as undefined, of a union',
    z.object({ a: z.union([z.string(), z.number()]) }),
    { a: undefined },
  ],
  ['an item of a list of the wrong type', z.array(z.string()), ['a', 1]],
  ['an item of a list written as undefined', z.array(z.string()), ['a', undefined]],
  ['an item of a tuple written as undefined', z.tuple([z.string()]), [undefined]],
  ['a hole of a list', z.array(z.string()), withHole],
  ['the root, when it is a value of the wrong type', z.string(), 5],
  ['the root, when it is null', z.string(), null],
  ['the root, when it is undefined', z.string(), undefined],
  ['the root, when it is no object', z.object({ a: z.string() }), 'text'],
  ['a key a class instance lacks', z.object({ id: z.string(), total: z.number() }), new Row()],
  ['a key a class instance only inherits', z.object({ total: z.number() }), new Priced()],
];

function codesOf(schema: z.ZodType, value: unknown): readonly string[] {
  const parsed = parseValue(schema, value);
  return parsed.kind === 'issues' ? parsed.issues.map((issue) => issue.code) : [];
}

describe('parseValue', () => {
  test('a valid value comes back parsed, an open object stripped of unknown keys', () => {
    const value = { id: '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00', lines: [], extra: true };

    const parsed = parseValue(order, value);

    expect(parsed).toEqual({
      kind: 'value',
      value: { id: '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00', lines: [] },
    });
  });

  test('a failure is one issue with a nested path, cf-loom code and a message', () => {
    const value = { id: '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00', lines: [{ quantity: 0 }] };

    const parsed = parseValue(order, value);

    expect(parsed).toEqual({
      kind: 'issues',
      issues: [{ path: ['lines', 0, 'quantity'], code: 'too_small', message: expect.any(String) }],
    });
  });

  test('an issue never carries the received value', () => {
    const secret = 'the-secret-value';

    const parsed = parseValue(z.object({ id: z.uuid(), kind: z.enum(['a']) }), {
      id: secret,
      kind: secret,
    });

    expect(JSON.stringify(parsed)).not.toContain(secret);
  });

  test('a missing value is required and a value of the wrong type invalid_type', () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    const codes = codesOf(schema, { age: 'old' });

    expect(codes).toEqual(['required', 'invalid_type']);
  });

  test('a missing enum, literal or union field is required, whatever zod calls it', () => {
    const schema = z.object({
      status: z.enum(['paid']),
      kind: z.literal('order'),
      id: z.union([z.string(), z.number()]),
    });

    const codes = codesOf(schema, {});

    expect(codes).toEqual(['required', 'required', 'required']);
  });

  test('a missing discriminator is required at its key', () => {
    const schema = z.discriminatedUnion('t', [
      z.object({ t: z.literal('a') }),
      z.object({ t: z.literal('b') }),
    ]);

    const parsed = parseValue(schema, {});

    expect(parsed).toMatchObject({ kind: 'issues', issues: [{ path: ['t'], code: 'required' }] });
  });

  test('a key present with undefined is required, in an object, a record, a union or a discriminator', () => {
    const discriminated = z.discriminatedUnion('t', [
      z.object({ t: z.literal('a') }),
      z.object({ t: z.literal('b') }),
    ]);

    const codes = [
      ...codesOf(z.object({ name: z.string() }), { name: undefined }),
      ...codesOf(z.record(z.string(), z.string()), { a: undefined }),
      ...codesOf(z.object({ id: z.union([z.string(), z.number()]) }), { id: undefined }),
      ...codesOf(discriminated, { t: undefined }),
    ];

    expect(codes).toEqual(['required', 'required', 'required', 'required']);
  });

  test('undefined in a list or a tuple, or a hole of a list, is required', () => {
    const codes = [
      ...codesOf(z.array(z.string()), ['a', undefined]),
      ...codesOf(z.tuple([z.string()]), [undefined]),
      ...codesOf(z.array(z.string()), withHole),
    ];

    expect(codes).toEqual(['required', 'required', 'required']);
  });

  test('a key missing on a class instance is required', () => {
    const codes = codesOf(z.object({ id: z.string(), total: z.number() }), new Row());

    expect(codes).toEqual(['required']);
  });

  test('a key a class instance only inherits, whose getter answers the wrong type, is required', () => {
    const codes = codesOf(z.object({ total: z.number() }), new Priced());

    expect(codes).toEqual(['required']);
  });

  test.for(absenceRows)(
    'parseValue says required exactly where readWith says is missing: %s',
    ([_, schema, value]) => {
      const parsed = parseValue(schema, value);
      const read = readWith(schema, value, 'its format');

      const required =
        parsed.kind === 'issues'
          ? parsed.issues.filter((issue) => issue.code === 'required').map((issue) => issue.path)
          : [];
      const missing =
        read.kind === 'refused'
          ? read.problems
              .filter((problem) => problem.reason === 'is missing')
              .map((problem) => problem.at)
          : [];

      expect(required).toEqual(missing);
    },
  );

  test('a missing value is required', () => {
    const codes = codesOf(z.object({ id: z.string() }), undefined);

    expect(codes).toEqual(['required']);
  });

  test('a value outside an enum, a literal or a union is invalid_value', () => {
    const schema = z.object({
      status: z.enum(['paid']),
      kind: z.literal('order'),
      id: z.union([z.string(), z.number()]),
    });

    const codes = codesOf(schema, { status: 'lost', kind: 'refund', id: true });

    expect(codes).toEqual(['invalid_value', 'invalid_value', 'invalid_value']);
  });

  test('a bad format, a bound and a multiple keep their meaning', () => {
    const schema = z.object({
      email: z.email(),
      low: z.int().min(5),
      high: z.string().max(1),
      even: z.int().multipleOf(2),
    });

    const codes = codesOf(schema, { email: 'nope', low: 1, high: 'long', even: 3 });

    expect(codes).toEqual(['invalid_format', 'too_small', 'too_big', 'not_multiple']);
  });

  test('an enum-keyed record answers one unrecognized_key per key, the key on the path', () => {
    const schema = z.object({ inner: z.record(z.enum(['id']), z.string()) });

    const parsed = parseValue(schema, { inner: { id: 'a', first: 1, second: 2 } });

    expect(parsed).toEqual({
      kind: 'issues',
      issues: [
        { path: ['inner', 'first'], code: 'unrecognized_key', message: 'Unrecognized key' },
        { path: ['inner', 'second'], code: 'unrecognized_key', message: 'Unrecognized key' },
      ],
    });
  });

  test('a record key outside its schema is invalid_value', () => {
    const schema = z.record(z.string().min(2), z.string());

    const codes = codesOf(schema, { b: 'x' });

    expect(codes).toEqual(['invalid_value']);
  });

  test.each([
    ['a recursive object', tree, asObject],
    ['z.json()', z.json(), asList],
  ])(
    'a value nested past the stack in %s is one malformed issue at its root',
    (_, schema, wrap) => {
      const parsed = parseValue(schema, nestedTo(5000, wrap));

      expect(parsed).toEqual({ kind: 'issues', issues: [nestedTooDeeply] });
    },
  );

  test('a value of any depth is parsed or one malformed issue, never a throw', () => {
    const next = seededNext(219);
    const answers = new Set<string>();

    for (let draw = 0; draw < 60; draw += 1) {
      const depth = 1 + Math.floor(20_000 ** next() * next());
      const parsed = parseValue(tree, nestedTo(depth, asObject));
      answers.add(parsed.kind === 'value' ? 'parsed' : JSON.stringify(parsed.issues));
    }

    expect(answers).toEqual(new Set(['parsed', JSON.stringify([nestedTooDeeply])]));
  });
});

describe('encodedValueOf', () => {
  const shipment = z.object({
    stage: openEnumReader(['packed', 'shipped']),
    parcels: z.array(z.object({ weight: z.number().positive() })),
  });

  test('a value is written as its readers read it: unknown keys stripped, Unknown cases as text', () => {
    const value = { stage: { unknown: 'lost' }, parcels: [{ weight: 2, label: 'x' }], extra: 1 };

    const encoded = encodedValueOf(shipment, value);

    expect(encoded).toEqual({ kind: 'value', value: { stage: 'lost', parcels: [{ weight: 2 }] } });
  });

  test('a value that breaks a constraint is its Issues, with their paths', () => {
    const value = { stage: 'packed', parcels: [{ weight: 0 }] };

    const encoded = encodedValueOf(shipment, value);

    expect(encoded).toEqual({
      kind: 'issues',
      issues: [{ path: ['parcels', 0, 'weight'], code: 'too_small', message: expect.any(String) }],
    });
  });

  test('a missing field is required', () => {
    const encoded = encodedValueOf(shipment, { parcels: [] });

    expect(encoded).toMatchObject({
      kind: 'issues',
      issues: [{ path: ['stage'], code: 'required' }],
    });
  });

  test('an Unknown case holding a declared value is invalid_value at its path', () => {
    const encoded = encodedValueOf(shipment, { stage: { unknown: 'shipped' }, parcels: [] });

    expect(encoded).toMatchObject({
      kind: 'issues',
      issues: [{ path: ['stage'], code: 'invalid_value' }],
    });
  });

  test('a value nested past the stack is one malformed issue at its root', () => {
    const encoded = encodedValueOf(tree, nestedTo(5000, asObject));

    expect(encoded).toEqual({ kind: 'issues', issues: [nestedTooDeeply] });
  });
});

/** A value whose `id` getter throws `thrown`, as code a parse calls may. */
function valueThatThrows(thrown: unknown): unknown {
  return Object.defineProperty({}, 'id', {
    enumerable: true,
    get(): string {
      throw thrown;
    },
  });
}

/** SpiderMonkey's error class, which is no global outside Firefox, so an error that is named so. */
function internalError(message: string): Error {
  return Object.assign(new Error(message), { name: 'InternalError' });
}

function thrownBy(read: () => unknown): unknown {
  try {
    read();
  } catch (thrown) {
    return thrown;
  }
  return undefined;
}

describe.for([
  ['parseValue', (value: unknown) => parseValue(z.object({ id: z.string() }), value)],
  ['encodedValueOf', (value: unknown) => encodedValueOf(z.object({ id: z.string() }), value)],
] as const)('%s of a value whose read throws', ([, read]) => {
  test.for([
    ['an InternalError, as Firefox throws past the stack', internalError('too much recursion')],
    [
      'a RangeError with a period, as Safari words it',
      new RangeError('Maximum call stack size exceeded.'),
    ],
  ])('%s, is one malformed issue at its root', ([, overflow]) => {
    const parsed = read(valueThatThrows(overflow));

    expect(parsed).toEqual({ kind: 'issues', issues: [nestedTooDeeply] });
  });

  test.for([
    ['a RangeError that is no overflow', new RangeError('Invalid array length')],
    ['an InternalError that is no overflow', internalError('allocation size overflow')],
    ['a TypeError', new TypeError('getter broke')],
    ['a plain Error', new Error('getter broke')],
    ['a value that is no error', { reason: 'getter broke' }],
  ])('%s still throws', ([, thrown]) => {
    const rethrown = thrownBy(() => read(valueThatThrows(thrown)));

    expect(rethrown).toBe(thrown);
  });
});
