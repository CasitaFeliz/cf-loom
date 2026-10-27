import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { refusalsOf } from '../../test/failures.ts';
import { type SchemaNode, walkSchemas } from '../internal/index.ts';

function walkBody(schema: core.$ZodType) {
  const at = { site: { kind: 'export', name: 'body' }, declaration: undefined, steps: [] } as const;
  return refusalsOf(walkSchemas([{ at, schema }], () => undefined));
}

function walkedTo(node: SchemaNode) {
  return { located: [{ kind: 'walked', value: node }], defs: {} };
}

describe('walkSchemas: arrays and tuples', () => {
  test('an array holds its item schema', () => {
    expect(walkBody(z.array(z.string()))).toEqual(
      walkedTo({ type: 'array', items: { type: 'string' } }),
    );
  });

  test('an array keeps its length bounds', () => {
    expect(walkBody(z.array(z.string()).min(1).max(5))).toEqual(
      walkedTo({ type: 'array', items: { type: 'string' }, min: 1, max: 5 }),
    );
  });

  test('an array of an exact length is min equal to max', () => {
    expect(walkBody(z.array(z.string()).length(2))).toEqual(
      walkedTo({ type: 'array', items: { type: 'string' }, min: 2, max: 2 }),
    );
  });

  test('a tuple keeps its items in order', () => {
    expect(walkBody(z.tuple([z.string(), z.number()]))).toEqual(
      walkedTo({ type: 'tuple', items: [{ type: 'string' }, { type: 'number' }] }),
    );
  });

  test('a tuple with a rest schema carries it as rest', () => {
    expect(walkBody(z.tuple([z.string()], z.number()))).toEqual(
      walkedTo({ type: 'tuple', items: [{ type: 'string' }], rest: { type: 'number' } }),
    );
  });
});
