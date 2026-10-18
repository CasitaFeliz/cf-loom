import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  return walkSchemas([{ at: ['body'], schema }], () => undefined);
}

const categoryDef = {
  type: 'object',
  mode: 'open',
  fields: {
    name: { required: true, schema: { type: 'string' } },
    children: {
      required: true,
      schema: { type: 'array', items: { type: 'ref', name: 'category' } },
    },
  },
} as const;

describe('walkSchemas: recursion', () => {
  test('a cycle through a getter is written once under defs and referenced by ref', () => {
    const category = z
      .object({
        name: z.string(),
        get children() {
          return z.array(category);
        },
      })
      .meta({ id: 'category' });

    expect(walkBody(category)).toEqual({
      kind: 'walked',
      nodes: [{ type: 'ref', name: 'category' }],
      defs: { category: categoryDef },
    });
  });

  test('a cycle through z.lazy() is written once under defs and referenced by ref', () => {
    type Category = { name: string; children: Category[] };
    const category: z.ZodType<Category> = z
      .lazy(() => z.object({ name: z.string(), children: z.array(category) }))
      .meta({ id: 'category' });

    expect(walkBody(category)).toEqual({
      kind: 'walked',
      nodes: [{ type: 'ref', name: 'category' }],
      defs: { category: categoryDef },
    });
  });

  test('a cyclic schema used at two locations is one def', () => {
    const category = z
      .object({
        name: z.string(),
        get children() {
          return z.array(category);
        },
      })
      .meta({ id: 'category' });

    const walked = walkSchemas(
      [
        { at: ['body'], schema: category },
        { at: ['success'], schema: z.array(category) },
      ],
      () => undefined,
    );

    expect(walked).toEqual({
      kind: 'walked',
      nodes: [
        { type: 'ref', name: 'category' },
        { type: 'array', items: { type: 'ref', name: 'category' } },
      ],
      defs: { category: categoryDef },
    });
  });

  test('a cycle without an id fails where it closes', () => {
    const category = z.object({
      get children() {
        return z.array(category);
      },
    });

    expect(walkBody(category)).toEqual({
      kind: 'not-allowed',
      failures: [
        {
          at: ['body', 'fields', 'children', 'items'],
          construct: 'a cycle without .meta({ id })',
          instead: '.meta({ id })',
        },
      ],
    });
  });

  test('two cyclic schemas with one id fail', () => {
    const category = z
      .object({
        get children() {
          return z.array(category);
        },
      })
      .meta({ id: 'Node' });
    const folder = z
      .object({
        get folders() {
          return z.array(folder);
        },
      })
      .meta({ id: 'Node' });

    const walked = walkSchemas(
      [
        { at: ['body'], schema: category },
        { at: ['success'], schema: folder },
      ],
      () => undefined,
    );

    expect(walked).toEqual({
      kind: 'not-allowed',
      failures: [{ at: ['success'], construct: 'two schemas with .meta({ id: "Node" })' }],
    });
  });

  test('an id on a schema that closes no cycle is ignored', () => {
    const money = z.object({ amount: z.int() }).meta({ id: 'Money' });

    expect(walkBody(money)).toEqual({
      kind: 'walked',
      nodes: [
        {
          type: 'object',
          mode: 'open',
          fields: { amount: { required: true, schema: { type: 'number', int: true } } },
        },
      ],
      defs: {},
    });
  });
});
