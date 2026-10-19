import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { defineContract, defineEndpoint, defineGroup, openEnum } from '../index.ts';
import { validateContract } from '../internal/index.ts';

/** Validates a Contract whose one Endpoint answers the body given. */
function validatedWithBody(body: core.$ZodType) {
  const echo = defineEndpoint({
    name: 'echo',
    method: 'GET',
    path: '/echo',
    visibility: 'public',
    description: 'Echo',
    success: { status: 200, body },
  });
  const group = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [echo] });
  const contract = defineContract({ name: 'shapes-service', groups: [group] });
  return validateContract(contract, {
    originOf: () => undefined,
    packageName: 'shapes-service',
    exportsOf: () => [],
  });
}

const refusal = {
  kind: 'not-allowed',
  construct: 'an intersection that is not of open objects reaching an openEnum()',
  instead: '.extend()',
};

const bodyAt = ['groups', 'shapes', 'endpoints', 'GET /echo', 'success', 'body'];

describe('validateContract: an intersection reaching an Open Enum', () => {
  test('an intersection of an object and a discriminated union is allowed', () => {
    const payment = z.discriminatedUnion('type', [z.object({ type: z.literal('card') })]);
    const body = z.intersection(z.object({ type: z.string() }), payment);

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });

  test('an intersection with an Open Enum deep inside is not allowed where it is written', () => {
    const status = z.object({ inner: z.object({ status: openEnum(['a']) }) });
    const body = z.object({
      both: z.intersection(status, z.record(z.string(), z.json())),
    });

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...refusal, at: [...bodyAt, 'fields', 'both'] }],
    });
  });

  test('an intersection reaching an Open Enum through a recursive def is not allowed', () => {
    const tree = z
      .object({
        status: openEnum(['a']),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.intersection(z.object({ root: tree }), z.record(z.string(), z.json()));

    const validated = validatedWithBody(body);

    expect(validated).toEqual({ kind: 'invalid', failures: [{ ...refusal, at: bodyAt }] });
  });

  test('an intersection inside a recursive def is not allowed once, where the def is', () => {
    const tree = z
      .object({
        both: z.intersection(z.object({ status: openEnum(['a']) }), z.record(z.string(), z.json())),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.object({ first: tree, second: tree });

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...refusal, at: ['defs', 'tree', 'fields', 'both'] }],
    });
  });

  test.each([
    [
      'an intersection',
      (inner: core.$ZodType) =>
        z.intersection(inner, z.union([z.object({ c: z.string() }), z.object({ d: z.string() })])),
    ],
    [
      'a union in an intersection',
      (inner: core.$ZodType) =>
        z.intersection(z.union([inner, z.object({ e: z.string() })]), z.object({ f: z.string() })),
    ],
  ])(
    'an intersection reaching an Open Enum inside %s is reported once, at the outer one',
    (_outer, outerOf) => {
      const options = z.union([z.object({ s: openEnum(['a']) }), z.object({ t: z.string() })]);
      const inner = z.intersection(options, z.object({ b: z.string() }));

      const validated = validatedWithBody(outerOf(inner));

      expect(validated).toEqual({ kind: 'invalid', failures: [{ ...refusal, at: bodyAt }] });
    },
  );

  test('two separate intersections reaching an Open Enum are each reported', () => {
    const open = () =>
      z.intersection(
        z.union([z.object({ s: openEnum(['a']) }), z.object({ q: z.string() })]),
        z.object({ b: z.string() }),
      );

    const validated = validatedWithBody(z.object({ a: open(), b: open() }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...refusal, at: [...bodyAt, 'fields', 'a'] },
        { ...refusal, at: [...bodyAt, 'fields', 'b'] },
      ],
    });
  });

  test('two intersections reaching an Open Enum at different depths are each reported', () => {
    const open = () =>
      z.intersection(
        z.union([z.object({ s: openEnum(['a']) }), z.object({ q: z.string() })]),
        z.object({ b: z.string() }),
      );

    const validated = validatedWithBody(z.object({ a: open(), b: z.object({ c: open() }) }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...refusal, at: [...bodyAt, 'fields', 'a'] },
        { ...refusal, at: [...bodyAt, 'fields', 'b', 'fields', 'c'] },
      ],
    });
  });

  test('an intersection in a def is judged even when the schema using it fails the walk', () => {
    const tree = z
      .object({
        x: z.intersection(
          z.union([z.object({ s: openEnum(['a']) }), z.object({ q: z.string() })]),
          z.object({ b: z.string() }),
        ),
        get c() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });

    const validated = validatedWithBody(z.object({ bad: z.any(), t: tree }));

    expect(validated.kind === 'invalid' ? validated.failures : []).toEqual(
      expect.arrayContaining([
        { ...refusal, at: ['defs', 'tree', 'fields', 'x'] },
        expect.objectContaining({ at: [...bodyAt, 'fields', 'bad'] }),
      ]),
    );
  });

  test('an intersection with no Open Enum is allowed', () => {
    const body = z.intersection(
      z.object({ status: z.enum(['a']) }),
      z.record(z.string(), z.string()),
    );

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });

  test('an Open Enum in a merged intersection of open objects is allowed', () => {
    const body = z.intersection(z.object({ status: openEnum(['a']) }), z.object({ b: z.string() }));

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });
});
