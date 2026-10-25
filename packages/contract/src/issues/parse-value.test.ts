import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { openEnumReader } from '../index.ts';
import { encodedValueOf, parseValue } from '../internal/index.ts';

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

  test('a key present with undefined is invalid_type, in an object or a record', () => {
    const codes = [
      ...codesOf(z.object({ name: z.string() }), { name: undefined }),
      ...codesOf(z.record(z.string(), z.string()), { a: undefined }),
    ];

    expect(codes).toEqual(['invalid_type', 'invalid_type']);
  });

  test('undefined inside an array, a tuple or a Set is invalid_type', () => {
    const codes = [
      ...codesOf(z.array(z.string()), ['a', undefined]),
      ...codesOf(z.tuple([z.string()]), [undefined]),
      ...codesOf(z.set(z.string()), new Set([undefined])),
    ];

    expect(codes).toEqual(['invalid_type', 'invalid_type', 'invalid_type']);
  });

  test('a key missing on a class instance is required', () => {
    class Row {
      readonly id = 'r-1';
    }

    const codes = codesOf(z.object({ id: z.string(), total: z.number() }), new Row());

    expect(codes).toEqual(['required']);
  });

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

  test('a throw that is no stack overflow still throws', () => {
    const broken = new Error('getter broke');
    const value = Object.defineProperty({}, 'id', {
      enumerable: true,
      get(): string {
        throw broken;
      },
    });

    const parse = () => parseValue(z.object({ id: z.string() }), value);

    expect(parse).toThrow(broken);
  });

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
