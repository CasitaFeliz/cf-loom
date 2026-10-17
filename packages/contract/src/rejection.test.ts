import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineRejection } from './index.ts';

describe('defineRejection', () => {
  test('a Rejection keeps its body schema by identity', () => {
    const body = z.object({ lockedAt: z.iso.datetime() });

    const orderLocked = defineRejection({
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'The order can no longer be changed',
      body,
    });

    expect(orderLocked.body).toBe(body);
  });

  test('a Rejection status outside 400–499 is a type error', () => {
    const declare = () => [
      // @ts-expect-error a Rejection status is 4xx
      defineRejection({ code: 'TEAPOT', status: 500, message: 'Server' }),
      // @ts-expect-error a Rejection status is 4xx
      defineRejection({ code: 'MOVED', status: 399, message: 'Moved' }),
      defineRejection({ code: 'FIRST', status: 400, message: 'First' }),
      defineRejection({ code: 'LAST', status: 499, message: 'Last' }),
    ];

    expect(declare).not.toThrow();
  });
});
