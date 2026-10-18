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

describe('walkSchemas: strings', () => {
  test('a string is a string node', () => {
    expect(walkBody(z.string())).toEqual(walkedTo({ type: 'string' }));
  });

  test('min and max length are min and max', () => {
    const name = z.string().min(1).max(50);

    expect(walkBody(name)).toEqual(walkedTo({ type: 'string', min: 1, max: 50 }));
  });

  test('an exact length is min equal to max', () => {
    expect(walkBody(z.string().length(3))).toEqual(walkedTo({ type: 'string', min: 3, max: 3 }));
  });

  test('a format schema is a string with its format', () => {
    expect(walkBody(z.uuid())).toEqual(walkedTo({ type: 'string', format: 'uuid' }));
  });

  test('a format written as a check is the same string with its format', () => {
    expect(walkBody(z.string().email())).toEqual(walkedTo({ type: 'string', format: 'email' }));
  });

  test('a format carries the options it declares', () => {
    const placedAt = z.iso.datetime({ offset: true, precision: 3 });

    expect(walkBody(placedAt)).toEqual(
      walkedTo({
        type: 'string',
        format: 'datetime',
        formatOptions: { offset: true, precision: 3 },
      }),
    );
  });

  test('a format with its length bounds keeps both', () => {
    expect(walkBody(z.email().max(100))).toEqual(
      walkedTo({ type: 'string', format: 'email', max: 100 }),
    );
  });

  test('a regex stores its source and flags', () => {
    const code = z.string().regex(/^[a-z]+$/iu);

    expect(walkBody(code)).toEqual(
      walkedTo({ type: 'string', regex: { source: '^[a-z]+$', flags: 'iu' } }),
    );
  });

  test('.brand() changes no shape, so a branded string is a string', () => {
    expect(walkBody(z.string().brand<'OrderId'>())).toEqual(walkedTo({ type: 'string' }));
  });

  test('a zod/mini string with checks walks like a zod one', () => {
    const name = zm.string().check(zm.minLength(1), zm.maxLength(50));

    expect(walkBody(name)).toEqual(walkedTo({ type: 'string', min: 1, max: 50 }));
  });
});

describe('walkSchemas: numbers', () => {
  test('a number is a number node', () => {
    expect(walkBody(z.number())).toEqual(walkedTo({ type: 'number' }));
  });

  test('inclusive bounds are min and max', () => {
    expect(walkBody(z.number().min(0).max(10))).toEqual(
      walkedTo({ type: 'number', min: 0, max: 10 }),
    );
  });

  test('exclusive bounds are exclusiveMin and exclusiveMax', () => {
    expect(walkBody(z.number().gt(0).lt(10))).toEqual(
      walkedTo({ type: 'number', exclusiveMin: 0, exclusiveMax: 10 }),
    );
  });

  test('multipleOf is multipleOf', () => {
    expect(walkBody(z.number().multipleOf(5))).toEqual(walkedTo({ type: 'number', multipleOf: 5 }));
  });

  test('z.int() is int and implies no safe-integer bounds', () => {
    expect(walkBody(z.int())).toEqual(walkedTo({ type: 'number', int: true }));
  });

  test('.int() on a number is int', () => {
    expect(walkBody(z.number().int().min(1))).toEqual(
      walkedTo({ type: 'number', int: true, min: 1 }),
    );
  });

  test('a zod/mini int walks like a zod one', () => {
    expect(walkBody(zm.int())).toEqual(walkedTo({ type: 'number', int: true }));
  });
});

describe('walkSchemas: booleans, literals and JSON', () => {
  test('a boolean is a boolean node', () => {
    expect(walkBody(z.boolean())).toEqual(walkedTo({ type: 'boolean' }));
  });

  test('a literal keeps its value with its JSON type', () => {
    expect(walkBody(z.literal(true))).toEqual(walkedTo({ type: 'literal', value: true }));
    expect(walkBody(z.literal('true'))).toEqual(walkedTo({ type: 'literal', value: 'true' }));
    expect(walkBody(z.literal(2))).toEqual(walkedTo({ type: 'literal', value: 2 }));
  });

  test('a literal of several values is an enum of them', () => {
    expect(walkBody(z.literal(['b', 'a']))).toEqual(
      walkedTo({ type: 'enum', values: ['a', 'b'], open: false }),
    );
  });

  test('a literal of several values holds each value once', () => {
    expect(walkBody(z.literal(['a', 'a']))).toEqual(
      walkedTo({ type: 'enum', values: ['a'], open: false }),
    );
  });

  test('z.json() is any JSON value', () => {
    expect(walkBody(z.json())).toEqual(walkedTo({ type: 'json' }));
  });

  test('a zod/mini z.json() is any JSON value', () => {
    expect(walkBody(zm.json())).toEqual(walkedTo({ type: 'json' }));
  });
});
