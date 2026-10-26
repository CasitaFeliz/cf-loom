import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineEndpoint, defineRejection, invalidInput, notFound } from '../index.ts';
import { rejectionShapeOf, shapeFieldsOf, successShapeOf } from '../internal/index.ts';

const base = {
  method: 'GET',
  path: '/payments',
  visibility: 'internal',
  description: 'Payments',
} as const;

const rateLimited = defineRejection({
  code: 'RATE_LIMITED',
  status: 429,
  message: 'Slow down',
  headers: z.object({ 'retry-after': z.int() }),
  body: z.object({ limit: z.int() }),
});

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'Locked',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });

const issuesReader = z.object({ issues: z.array(z.object({ message: z.string() })) });
const standards = {
  invalidInput: {
    code: 'BAD_REQUEST',
    status: 422,
    message: 'The request is invalid',
    body: issuesReader,
  },
  notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
} as const;

describe('successShapeOf', () => {
  test('a Success’s shape holds its headers and body, each in the Part it sits in', () => {
    const headers = z.object({ 'x-count': z.int() });
    const body = z.string();
    const endpoint = defineEndpoint({
      ...base,
      name: 'listPayments',
      success: { status: 200, headers, body },
    });

    const shape = successShapeOf(endpoint);

    expect(shape.headers).toEqual({ part: 'success.headers', schema: headers });
    expect(shape.body).toEqual({ part: 'success.body', schema: body });
    expect(shape.body.schema).toBe(body);
  });

  test('a part the Success declares no schema for has none', () => {
    const endpoint = defineEndpoint({
      ...base,
      name: 'listPayments',
      success: { status: 204 },
    });

    const shape = successShapeOf(endpoint);

    expect(shape).toEqual({
      headers: { part: 'success.headers', schema: undefined },
      body: { part: 'success.body', schema: undefined },
    });
  });
});

describe('rejectionShapeOf', () => {
  test('a Rejection’s shape holds its headers and body, each in a Part of its own', () => {
    const shape = rejectionShapeOf(rateLimited);

    expect(shape.headers).toEqual({ part: 'headers', schema: rateLimited.headers });
    expect(shape.body).toEqual({ part: 'body', schema: rateLimited.body });
  });

  test('a Rejection that declares neither has none, and a Standard Rejection never declares headers', () => {
    const shapes = [gone, notFound, invalidInput].map((rejection) => rejectionShapeOf(rejection));

    expect(shapes.map(({ headers, body }) => [headers.schema, body.schema])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  test('a Rejection’s body is read by its declared schema', () => {
    const shapes = [orderLocked, gone, notFound].map((rejection) =>
      rejectionShapeOf(rejection, standards),
    );

    expect(shapes.map(({ body }) => body.schema)).toEqual([orderLocked.body, undefined, undefined]);
  });

  test('invalid input’s body is read by the Reader the Provider’s Standard Rejections carry', () => {
    const shape = rejectionShapeOf(invalidInput, standards);

    expect(shape.body.schema).toBe(issuesReader);
  });
});

describe('shapeFieldsOf', () => {
  test('a shape with no headers is given its body alone, whatever it holds', () => {
    const shape = rejectionShapeOf(orderLocked);

    const fields = shapeFieldsOf(shape, { headers: 'h', body: 'b' });

    expect(fields).toEqual({ headers: undefined, body: { headers: 'h', body: 'b' } });
  });

  test('a shape with headers is given its headers and body by field', () => {
    const shape = rejectionShapeOf(rateLimited);

    const fields = shapeFieldsOf(shape, { headers: { 'retry-after': 1 }, body: { limit: 2 } });

    expect(fields).toEqual({ headers: { 'retry-after': 1 }, body: { limit: 2 } });
  });

  test('a shape with headers, given no object, is given neither', () => {
    const shape = successShapeOf(
      defineEndpoint({
        ...base,
        name: 'listPayments',
        success: { status: 200, headers: z.object({ 'x-count': z.int() }), body: z.string() },
      }),
    );

    const fields = [undefined, null, 'text', 3].map((given) => shapeFieldsOf(shape, given));

    expect(fields).toEqual(
      Array.from({ length: 4 }, () => ({ headers: undefined, body: undefined })),
    );
  });
});
