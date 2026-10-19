import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import type * as core from 'zod/v4/core';
import { openEnum } from '../index.ts';
import { type SchemaNode, walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  return walkSchemas([{ at: ['body'], schema }], () => undefined);
}

function walkedTo(node: SchemaNode) {
  return { located: [{ at: ['body'], walked: { kind: 'walked', value: node } }], defs: {} };
}

function refusedAt(at: readonly (string | number)[], construct: string, instead?: string) {
  const failure = { kind: 'not-allowed', at, construct, ...(instead && { instead }) };
  return {
    located: [{ at: ['body'], walked: { kind: 'not-allowed', failures: [failure] } }],
    defs: {},
  };
}

const text = { type: 'string' } as const;
const amount = { type: 'number' } as const;

describe('walkSchemas: objects', () => {
  test('an object is open with each field required', () => {
    const order = z.object({ id: z.string(), total: z.number() });

    expect(walkBody(order)).toEqual(
      walkedTo({
        type: 'object',
        mode: 'open',
        fields: { id: { required: true, schema: text }, total: { required: true, schema: amount } },
      }),
    );
  });

  test('a strict object is strict', () => {
    expect(walkBody(z.strictObject({ id: z.string() }))).toEqual(
      walkedTo({
        type: 'object',
        mode: 'strict',
        fields: { id: { required: true, schema: text } },
      }),
    );
  });

  test('an optional field is not required', () => {
    expect(walkBody(z.object({ note: z.string().optional() }))).toEqual(
      walkedTo({
        type: 'object',
        mode: 'open',
        fields: { note: { required: false, schema: text } },
      }),
    );
  });

  test('a nullable field is required and nullable', () => {
    const order = z.object({ note: z.string().nullable() });

    expect(walkBody(order)).toEqual(
      walkedTo({
        type: 'object',
        mode: 'open',
        fields: { note: { required: true, schema: { type: 'string', nullable: true } } },
      }),
    );
  });

  test('a nullish field is optional and nullable, each its own flag', () => {
    const order = z.object({ note: z.string().nullish() });

    expect(walkBody(order)).toEqual(
      walkedTo({
        type: 'object',
        mode: 'open',
        fields: { note: { required: false, schema: { type: 'string', nullable: true } } },
      }),
    );
  });

  test('optional anywhere but directly on an object field fails', () => {
    expect(walkBody(z.array(z.string().optional()))).toEqual(
      refusedAt(['body', 'items'], '.optional()'),
    );
  });

  test('a check on an optional field fails like a check on any schema', () => {
    const order = z.object({
      note: z
        .string()
        .optional()
        .refine((note) => note !== ''),
    });

    expect(walkBody(order)).toEqual(refusedAt(['body', 'fields', 'note'], '.refine()'));
  });

  test('.required() makes an optional field required', () => {
    const order = z.object({ note: z.string().optional(), id: z.string() }).required();

    expect(walkBody(order)).toEqual(
      walkedTo({
        type: 'object',
        mode: 'open',
        fields: { note: { required: true, schema: text }, id: { required: true, schema: text } },
      }),
    );
  });

  test('a zod/mini optional field is not required', () => {
    expect(walkBody(zm.object({ note: zm.optional(zm.string()) }))).toEqual(
      walkedTo({
        type: 'object',
        mode: 'open',
        fields: { note: { required: false, schema: text } },
      }),
    );
  });
});

describe('walkSchemas: records', () => {
  test('a string-keyed record is a record', () => {
    expect(walkBody(z.record(z.string(), z.number()))).toEqual(
      walkedTo({ type: 'record', key: text, value: amount }),
    );
  });

  test('an enum-keyed record is a strict object with every key required', () => {
    const totals = z.record(z.enum(['eur', 'usd']), z.number());

    expect(walkBody(totals)).toEqual(
      walkedTo({
        type: 'object',
        mode: 'strict',
        fields: {
          eur: { required: true, schema: amount },
          usd: { required: true, schema: amount },
        },
      }),
    );
  });

  test('a literal-keyed record is a strict object with the key required', () => {
    expect(walkBody(z.record(z.literal('eur'), z.number()))).toEqual(
      walkedTo({
        type: 'object',
        mode: 'strict',
        fields: { eur: { required: true, schema: amount } },
      }),
    );
  });

  test('a partial record is a strict object with every key optional', () => {
    const totals = z.partialRecord(z.enum(['eur', 'usd']), z.number());

    expect(walkBody(totals)).toEqual(
      walkedTo({
        type: 'object',
        mode: 'strict',
        fields: {
          eur: { required: false, schema: amount },
          usd: { required: false, schema: amount },
        },
      }),
    );
  });

  test.each([
    ['string', z.string().nullable()],
    ['enum', z.enum(['eur']).nullable()],
  ])('a record with a nullable %s key fails', (_kind, key) => {
    const keyTypedAsString = key as unknown as z.ZodString;

    expect(walkBody(z.record(keyTypedAsString, z.number()))).toEqual(
      refusedAt(['body'], 'a nullable z.record() key'),
    );
  });

  test('a record keyed by an openEnum fails', () => {
    expect(walkBody(z.record(openEnum(['eur', 'usd']), z.number()))).toEqual(
      refusedAt(['body'], 'a z.record() keyed by an openEnum()', 'z.record(z.string(), …)'),
    );
  });

  test('a number-keyed record fails', () => {
    expect(walkBody(z.record(z.number(), z.string()))).toEqual(
      refusedAt(['body'], 'a z.record() key that is not a string, an enum or a literal'),
    );
  });
});

describe('walkSchemas: intersections', () => {
  test('an intersection of open objects whose shared keys agree is one open object', () => {
    const named = z.object({ id: z.string(), name: z.string() });
    const priced = z.object({ id: z.string(), total: z.number() });

    expect(walkBody(z.intersection(named, priced))).toEqual(
      walkedTo({
        type: 'object',
        mode: 'open',
        fields: {
          id: { required: true, schema: text },
          name: { required: true, schema: text },
          total: { required: true, schema: amount },
        },
      }),
    );
  });

  test('an intersection with a strict object fails', () => {
    const named = z.strictObject({ name: z.string() });
    const priced = z.object({ total: z.number() });

    expect(walkBody(named.and(priced))).toEqual(
      refusedAt(['body'], 'an intersection with a strict object', '.extend()'),
    );
  });

  test('an intersection of objects whose shared key differs fails', () => {
    const named = z.object({ id: z.string() });
    const numbered = z.object({ id: z.number() });

    expect(walkBody(named.and(numbered))).toEqual(
      refusedAt(['body'], 'an intersection of objects whose shared keys differ', '.extend()'),
    );
  });

  test.each([
    ['first', z.object({ toString: z.string() }), z.object({ name: z.string() })],
    ['second', z.object({ name: z.string() }), z.object({ toString: z.string() })],
  ])(
    'a key named like an Object method, in the %s object, merges like any key',
    (_order, left, right) => {
      expect(walkBody(z.intersection(left, right))).toEqual(
        walkedTo({
          type: 'object',
          mode: 'open',
          fields: {
            name: { required: true, schema: text },
            toString: { required: true, schema: text },
          },
        }),
      );
    },
  );

  test('any other intersection is allOf', () => {
    const bounded = z.intersection(z.string().min(1), z.string().max(10));

    expect(walkBody(bounded)).toEqual(
      walkedTo({
        type: 'allOf',
        items: [
          { type: 'string', max: 10 },
          { type: 'string', min: 1 },
        ],
      }),
    );
  });
});

describe('walkSchemas: a field named __proto__', () => {
  const construct = 'a field named __proto__ (zod drops it when parsing)';

  test('an object field named __proto__ is not allowed', () => {
    const schema = z.object({ ['__proto__']: z.string(), b: z.string() });

    expect(walkBody(schema)).toEqual(refusedAt(['body', 'fields', '__proto__'], construct));
  });

  test('a discriminator named __proto__ is not allowed', () => {
    const schema = z.discriminatedUnion('__proto__', [z.object({ ['__proto__']: z.literal('a') })]);

    expect(walkBody(schema)).toEqual(
      refusedAt(['body', 'variants', 0, 'fields', '__proto__'], construct),
    );
  });

  test('a record keyed by an enum holding __proto__ is not allowed', () => {
    const schema = z.record(z.enum(['__proto__', 'a']), z.number());

    expect(walkBody(schema)).toEqual(refusedAt(['body'], construct));
  });

  test('a record keyed by any string is allowed', () => {
    const schema = z.record(z.string(), z.number());

    expect(walkBody(schema).located[0]?.walked.kind).toBe('walked');
  });
});
