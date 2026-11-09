import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { isWhole, walkSchemas } from '../internal/index.ts';

/** The outline a failed walk of one schema kept. */
function outlineOf(schema: core.$ZodType) {
  const site = { kind: 'export', name: 'shape' } as const;
  const at = { site, declaration: undefined, steps: undefined };
  const [located] = walkSchemas([{ at, schema }], () => undefined).located;
  if (located?.walked.kind !== 'not-allowed') {
    throw new Error('The schema walked whole.');
  }
  return located.walked.outline;
}

describe('the outline of a failed walk', () => {
  test('an object keeps its fields: the refused one is unbuilt, the others are their node', () => {
    const outline = outlineOf(z.object({ id: z.string(), placedAt: z.date() }));

    expect(outline).toMatchObject({
      type: 'object',
      fields: { id: { required: true, schema: { type: 'string' } }, placedAt: { required: true } },
    });
    expect(isWhole(outline)).toBe(false);
    if (outline?.type !== 'object') {
      throw new Error('The outline is no object.');
    }
    expect(isWhole(outline.fields['id']?.schema)).toBe(true);
    expect(isWhole(outline.fields['placedAt']?.schema)).toBe(false);
    expect(outline.fields['placedAt']?.schema.type).toBeUndefined();
  });

  test('an object keeps whether each field is required', () => {
    const outline = outlineOf(z.object({ note: z.string().optional(), placedAt: z.date() }));

    expect(outline).toMatchObject({
      type: 'object',
      fields: { note: { required: false, schema: { type: 'string' } } },
    });
  });

  test('an object keeps the fields of an object inside it, down to the one refused', () => {
    const outline = outlineOf(z.object({ order: z.object({ id: z.string(), at: z.date() }) }));

    expect(outline).toMatchObject({
      type: 'object',
      fields: {
        order: { schema: { type: 'object', fields: { id: { schema: { type: 'string' } } } } },
      },
    });
  });

  test('an array keeps its items', () => {
    const outline = outlineOf(z.array(z.object({ id: z.string(), at: z.date() })));

    expect(outline).toMatchObject({
      type: 'array',
      items: { type: 'object', fields: { id: { schema: { type: 'string' } } } },
    });
  });

  test('a tuple keeps its items and its rest', () => {
    const outline = outlineOf(z.tuple([z.string(), z.date()], z.number()));

    expect(outline).toMatchObject({
      type: 'tuple',
      items: [{ type: 'string' }, {}],
      rest: { type: 'number' },
    });
  });

  test('a record keeps its string key and its value', () => {
    const outline = outlineOf(z.record(z.string(), z.object({ id: z.string(), at: z.date() })));

    expect(outline).toMatchObject({
      type: 'record',
      key: { type: 'string' },
      value: { type: 'object', fields: { id: { schema: { type: 'string' } } } },
    });
  });

  test('a union keeps every option', () => {
    const outline = outlineOf(z.union([z.object({ id: z.string() }), z.date()]));

    expect(outline).toMatchObject({
      type: 'union',
      options: [{ type: 'object', fields: { id: { schema: { type: 'string' } } } }, {}],
    });
  });

  test('a discriminated union keeps the variants that have one discriminator value', () => {
    const card = z.object({ kind: z.literal('card'), at: z.date() });
    const cash = z.object({ kind: z.literal('cash'), amount: z.number() });

    const outline = outlineOf(z.discriminatedUnion('kind', [card, cash]));

    expect(outline).toMatchObject({
      type: 'tagged',
      discriminator: 'kind',
      variants: {
        '"card"': { type: 'object', fields: { kind: { schema: { type: 'enum' } } } },
        '"cash"': { type: 'object', fields: { amount: { schema: { type: 'number' } } } },
      },
    });
  });

  test('`.nullable()` keeps the null and what the schema inside kept', () => {
    const outline = outlineOf(z.object({ id: z.string(), at: z.date() }).nullable());

    expect(outline).toMatchObject({
      type: 'object',
      nullable: true,
      fields: { id: { schema: { type: 'string' } } },
    });
  });

  test.each([
    ['a date', z.date()],
    ['a set', z.set(z.string())],
    ['a map', z.map(z.string(), z.string())],
    ['a pipe', z.string().pipe(z.string())],
    ['an enum of numbers', z.enum({ one: 1 })],
    ['an empty union', z.union([])],
    ['a literal of bigint', z.literal(1n)],
    ['a loose record', z.looseRecord(z.string(), z.string())],
    ['a record keyed by an enum', z.record(z.enum(['a']), z.string())],
  ])('%s is refused at its own schema, so it leaves nothing built', (_, schema) => {
    const outline = outlineOf(schema);

    expect(outline?.type).toBeUndefined();
    expect(isWhole(outline)).toBe(false);
  });

  test('an object holding a field named constructor is unbuilt, its fields still walked', () => {
    const outline = outlineOf(z.object({ constructor: z.string(), at: z.date() }));

    expect(outline?.type).toBeUndefined();
  });

  test('a node walked whole is whole, and one that fails on a check of its own is not', () => {
    const whole = outlineOf(z.object({ id: z.string() }).meta({ examples: [{ id: 1 }] }));

    expect(whole).toMatchObject({ type: 'object', fields: { id: { schema: { type: 'string' } } } });
    expect(isWhole(whole)).toBe(false);
  });
});
