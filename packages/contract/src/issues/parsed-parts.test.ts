import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineEndpoint } from '../index.ts';
import { inputParts, parsedPartsOf, schemaOf } from '../internal/index.ts';

const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders/:shopId',
  visibility: 'public',
  description: 'A new order',
  input: {
    params: z.object({ shopId: z.string() }),
    body: z.object({ quantity: z.int().min(1) }),
  },
  success: { status: 204 },
});

const schemaAt = (part: (typeof inputParts)[number]) => schemaOf(createOrder, part);

describe('parsedPartsOf', () => {
  test('each declared part is parsed under its field, unknown keys stripped, others not read', () => {
    const given = {
      params: { shopId: 's', extra: 1 },
      query: { ignored: true },
      body: { quantity: 2 },
    };

    const parsed = parsedPartsOf(inputParts, schemaAt, given);

    expect(parsed).toEqual({
      kind: 'value',
      value: { params: { shopId: 's' }, body: { quantity: 2 } },
    });
  });

  test('every part that fails gives its Issues at that part', () => {
    const given = { params: {}, body: { quantity: 0 } };

    const parsed = parsedPartsOf(inputParts, schemaAt, given);

    expect(parsed).toMatchObject({
      kind: 'issues',
      issues: [
        { part: 'input.params', path: ['shopId'], code: 'required' },
        { part: 'input.body', path: ['quantity'], code: 'too_small' },
      ],
    });
  });
});
