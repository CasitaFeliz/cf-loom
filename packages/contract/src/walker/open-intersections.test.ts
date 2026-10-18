import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { defineContract, defineEndpoint, defineGroup, openEnum, openUnion } from '../index.ts';
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
  construct: 'an intersection that is not of open objects reaching an openEnum() or an openUnion()',
  instead: '.extend()',
};

const bodyAt = ['groups', 'shapes', 'endpoints', 'GET /echo', 'success', 'body'];

describe('validateContract: an intersection reaching an Open Enum or an Open Union', () => {
  test('an intersection of an object and an Open Union is not allowed', () => {
    const payment = openUnion('type', [z.object({ type: z.literal('card') })]);
    const body = z.intersection(z.object({ type: z.string() }), payment);

    const validated = validatedWithBody(body);

    expect(validated).toEqual({ kind: 'invalid', failures: [{ ...refusal, at: bodyAt }] });
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

  test('an intersection with no Open Enum or Open Union is allowed', () => {
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
