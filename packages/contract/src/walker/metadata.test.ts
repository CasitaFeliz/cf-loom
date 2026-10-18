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

function cyclic(): Record<string, unknown> {
  const loop: Record<string, unknown> = {};
  loop['self'] = loop;
  return loop;
}

describe('walkSchemas: metadata', () => {
  test('.describe() sets the description', () => {
    expect(walkBody(z.string().describe('A name'))).toEqual(
      walkedTo({ type: 'string', description: 'A name' }),
    );
  });

  test('.meta() sets the description and examples', () => {
    const name = z.string().meta({ description: 'A name', examples: ['Ada'] });

    expect(walkBody(name)).toEqual(
      walkedTo({ type: 'string', description: 'A name', examples: ['Ada'] }),
    );
  });

  test('a zod/mini description is carried', () => {
    expect(walkBody(zm.string().check(zm.describe('A name')))).toEqual(
      walkedTo({ type: 'string', description: 'A name' }),
    );
  });

  test('the description of an optional field is carried on its schema', () => {
    const order = z.object({ note: z.string().optional().describe('A note') });

    expect(walkBody(order)).toEqual(
      walkedTo({
        type: 'object',
        mode: 'open',
        fields: { note: { required: false, schema: { type: 'string', description: 'A note' } } },
      }),
    );
  });

  test.each([
    ['a bigint', [1n]],
    ['a cyclic value', [cyclic()]],
    ['a function', [() => 'Ada']],
  ])('examples holding %s fail', (_name, examples) => {
    expect(walkBody(z.string().meta({ examples }))).toEqual({
      kind: 'not-allowed',
      failures: [{ at: ['body'], construct: 'examples that are not JSON values' }],
    });
  });

  test('any other .meta() key fails', () => {
    expect(walkBody(z.string().meta({ title: 'Name' }))).toEqual({
      kind: 'not-allowed',
      failures: [{ at: ['body'], construct: '.meta({ title })' }],
    });
  });
});

describe('walkSchemas: origin', () => {
  test('an origin returned by originOf is attached to the node', () => {
    const money = z.object({ amount: z.int() });

    const walked = walkSchemas([{ at: ['body'], schema: z.array(money) }], (schema) =>
      schema === money ? '@org/definitions@4.2.0#money' : undefined,
    );

    expect(walked).toEqual(
      walkedTo({
        type: 'array',
        items: {
          type: 'object',
          mode: 'open',
          fields: { amount: { required: true, schema: { type: 'number', int: true } } },
          origin: '@org/definitions@4.2.0#money',
        },
      }),
    );
  });
});
