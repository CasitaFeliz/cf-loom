import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import type * as core from 'zod/v4/core';
import { type SchemaNode, walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  return walkSchemas([{ at: ['body'], schema }], () => undefined);
}

function walkedTo(node: SchemaNode) {
  return { kind: 'walked', nodes: [node], defs: {} };
}

function refusedAt(at: readonly (string | number)[], construct: string, instead?: string) {
  return { kind: 'not-allowed', failures: [{ at, construct, ...(instead && { instead }) }] };
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
