import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import type * as core from 'zod/v4/core';
import { refusalsOf } from '../../test/failures.ts';
import { type SchemaNode, walkSchemas } from '../internal/index.ts';

const bodyAt = {
  site: { kind: 'export', name: 'body' },
  declaration: undefined,
  steps: [],
} as const;

function walkBody(schema: core.$ZodType) {
  return refusalsOf(walkSchemas([{ at: bodyAt, schema }], () => undefined));
}

function walkedTo(node: SchemaNode) {
  return { located: [{ kind: 'walked', value: node }], defs: {} };
}

function refusedAt(at: string, construct: string, instead?: string) {
  const failure = { kind: 'not-allowed', at, construct, ...(instead && { instead }) };
  return { located: [{ kind: 'not-allowed', failures: [failure] }], defs: {} };
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
        fields: { note: { required: false, schema: { type: 'string', description: 'A note' } } },
      }),
    );
  });

  test.each([
    ['a bigint', [1n]],
    ['a cyclic value', [cyclic()]],
    ['a function', [() => 'Ada']],
  ])('examples holding %s fail', (_name, examples) => {
    expect(walkBody(z.string().meta({ examples }))).toEqual(
      refusedAt('', 'examples that are not JSON values'),
    );
  });

  test('any other .meta() key fails', () => {
    expect(walkBody(z.string().meta({ title: 'Name' }))).toEqual(refusedAt('', '.meta({ title })'));
  });

  test.each(['123', '__proto__', 'tree-node', 'ñandú', 'Tree', ''])(
    'the id %j, which is no camelCase name, fails',
    (id) => {
      const order = z.object({ money: z.string().meta({ id }) });

      expect(walkBody(order)).toEqual(
        refusedAt('money', `.meta({ id: ${JSON.stringify(id)} })`, 'a camelCase name'),
      );
    },
  );

  test('an id that is not a string fails', () => {
    // @ts-expect-error zod types an id as a string
    const order = z.object({ money: z.string().meta({ id: 42 }) });

    expect(walkBody(order)).toEqual(refusedAt('money', '.meta({ id }) that is not a string'));
  });

  test('a description that is not a string fails', () => {
    // @ts-expect-error zod types a description as a string
    const order = z.object({ note: z.string().meta({ description: 42 }) });

    expect(walkBody(order)).toEqual(
      refusedAt('note', '.meta({ description }) that is not a string'),
    );
  });
});

describe('walkSchemas: origin', () => {
  test('an origin returned by originOf is attached to the node', () => {
    const money = z.object({ amount: z.int() });

    const walked = walkSchemas([{ at: bodyAt, schema: z.array(money) }], (schema) =>
      schema === money ? '@org/definitions@4.2.0#money' : undefined,
    );

    expect(refusalsOf(walked)).toEqual(
      walkedTo({
        type: 'array',
        items: {
          type: 'object',
          fields: { amount: { required: true, schema: { type: 'number', int: true } } },
          origin: '@org/definitions@4.2.0#money',
        },
      }),
    );
  });
});

describe('walkSchemas: examples', () => {
  test('an example the schema refuses fails with its index', () => {
    const schema = z
      .number()
      .min(0)
      .meta({ examples: [1, -5] });

    expect(walkBody(schema)).toEqual(refusedAt('', 'an example the schema refuses (examples[1])'));
  });

  test('examples the schema accepts walk and are kept', () => {
    const schema = z
      .number()
      .min(0)
      .meta({ examples: [0, 12] });

    expect(walkBody(schema)).toEqual(walkedTo({ type: 'number', min: 0, examples: [0, 12] }));
  });

  test('examples set before a check are parsed with that check', () => {
    const schema = z
      .string()
      .meta({ examples: ['ab'] })
      .min(3);

    expect(walkBody(schema)).toEqual(refusedAt('', 'an example the schema refuses (examples[0])'));
  });

  test('a zod/mini example the schema refuses fails', () => {
    const schema = zm.string().check(zm.minLength(3), zm.meta({ examples: ['ab'] }));

    expect(walkBody(schema)).toEqual(refusedAt('', 'an example the schema refuses (examples[0])'));
  });

  test("examples on a field's .optional() are parsed by the optional", () => {
    const order = z.object({
      note: z
        .string()
        .min(2)
        .optional()
        .meta({ examples: ['a'] }),
    });

    expect(walkBody(order)).toEqual(
      refusedAt('note', 'an example the schema refuses (examples[0])'),
    );
  });

  test('examples are not parsed on a schema that already fails, so no author function runs', () => {
    let calls = 0;
    const counted = (value: string) => {
      calls += 1;
      return value !== '';
    };
    const schema = z
      .string()
      .refine(counted)
      .meta({ examples: ['a'] });

    const walked = walkBody(schema);

    expect(walked).toEqual(refusedAt('', '.refine()'));
    expect(calls).toBe(0);
  });
});

describe('walkSchemas: every example a walked node carries parses', () => {
  test('whenever a schema with examples walks, its schema accepts each of them', () => {
    let state = 2222;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const pick = <Value>(values: readonly Value[]) =>
      values[Math.floor(next() * values.length)] as Value;
    let walkedCount = 0;
    for (let draw = 0; draw < 300; draw += 1) {
      const examples = [pick([-3, 0, 2, 7, 'ab', 'abcdef']), pick([1, 9, 'x', 'abcd'])];
      const schema =
        next() < 0.5
          ? z
              .number()
              .min(pick([-5, 0, 3]))
              .max(pick([5, 8]))
              .meta({ examples })
          : z
              .string()
              .min(pick([0, 2, 4]))
              .max(pick([4, 6]))
              .meta({ examples });

      const [located] = walkBody(schema).located;

      if (located?.kind === 'walked') {
        walkedCount += 1;
        for (const example of located.value.examples ?? []) {
          expect(schema.safeParse(example).success, `draw ${draw}: ${example}`).toBe(true);
        }
      }
    }
    expect(walkedCount).toBeGreaterThan(10);
  });
});
