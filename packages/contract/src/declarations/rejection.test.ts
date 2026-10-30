import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineRejection } from '../index.ts';

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

  test('a Rejection keeps its headers schema by identity', () => {
    const headers = z.object({ 'www-authenticate': z.string() });

    const unauthenticated = defineRejection({
      code: 'UNAUTHENTICATED',
      status: 401,
      message: 'Unauthenticated',
      headers,
    });

    expect(unauthenticated.headers).toBe(headers);
  });

  test('an upper-case Rejection header name is a type error', () => {
    const declare = () =>
      defineRejection({
        code: 'UNAUTHENTICATED',
        status: 401,
        message: 'Unauthenticated',
        // @ts-expect-error TS2375 header names are lower-case
        headers: z.object({ 'WWW-Authenticate': z.string() }),
      });

    expect(declare).not.toThrow();
  });

  test('a Rejection status of 400 and of 499 type-check', () => {
    const rejections = [
      defineRejection({ code: 'FIRST', status: 400, message: 'First' }),
      defineRejection({ code: 'LAST', status: 499, message: 'Last' }),
    ];

    expect(rejections.map((rejection) => rejection.status)).toEqual([400, 499]);
  });

  test('a Rejection status of 399 is a type error', () => {
    // @ts-expect-error TS2322 a Rejection status is 4xx
    const declare = () => defineRejection({ code: 'MOVED', status: 399, message: 'Moved' });

    expect(declare).not.toThrow();
  });

  test('a Rejection status of 500 is a type error', () => {
    // @ts-expect-error TS2322 a Rejection status is 4xx
    const declare = () => defineRejection({ code: 'BROKEN', status: 500, message: 'Broken' });

    expect(declare).not.toThrow();
  });
});

describe('defineRejection fields', () => {
  test('an undeclared field is a type error', () => {
    const declare = () =>
      // @ts-expect-error TS2322 bogus is not a field of a Rejection
      defineRejection({ code: 'GONE', status: 410, message: 'Gone', bogus: 1 });

    expect(declare).not.toThrow();
  });
});
