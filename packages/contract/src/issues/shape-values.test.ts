import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineRejection, openEnumReader, providedRejection } from '../index.ts';
import { parsedShapeOf, readShapeOf, rejectionShapeOf, writtenShapeOf } from '../internal/index.ts';

const rateLimited = defineRejection({
  code: 'RATE_LIMITED',
  status: 429,
  message: 'Slow down',
  headers: z.object({ 'retry-after': z.int().min(0), 'x-note': z.string().optional() }),
  body: z.object({ limit: z.int() }),
});

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
  headers: z.object({ 'www-authenticate': z.string() }),
});

const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });

/** A body schema that is optional, which the types refuse, as a declaration that bypassed them writes it. */
const optionalBody = z.string().optional() as unknown as z.ZodString;

const noted = defineRejection({ code: 'NOTED', status: 409, message: 'Noted', body: optionalBody });

describe('parsedShapeOf', () => {
  test('the parts the shape declares come back parsed, unknown keys stripped', () => {
    const shape = rejectionShapeOf(rateLimited);
    const given = {
      headers: { 'retry-after': 30, extra: 'x' },
      body: { limit: 5, extra: 1 },
    };

    const parsed = parsedShapeOf(shape, given);

    expect(parsed).toEqual({
      kind: 'value',
      value: { headers: { 'retry-after': 30 }, body: { limit: 5 } },
    });
  });

  test('a declared part given nothing comes back as the key, undefined, as every declared part does', () => {
    const shape = rejectionShapeOf(noted);

    const parsed = parsedShapeOf(shape, { headers: undefined, body: undefined });

    expect(parsed).toStrictEqual({ kind: 'value', value: { body: undefined } });
  });

  test('a part the shape declares none of comes back without its key', () => {
    const shape = rejectionShapeOf(gone);

    const parsed = parsedShapeOf(shape, { headers: undefined, body: undefined });

    expect(parsed).toStrictEqual({ kind: 'value', value: {} });
  });

  test('a value given where the shape declares none is an Issue at that part', () => {
    const shape = rejectionShapeOf(gone);

    const parsed = parsedShapeOf(shape, { headers: { a: 1 }, body: 'b' });

    expect(parsed).toEqual({
      kind: 'issues',
      issues: [
        { part: 'headers', path: [], code: 'invalid_type', message: 'Expected no value' },
        { part: 'body', path: [], code: 'invalid_type', message: 'Expected no value' },
      ],
    });
  });

  test('the Issues of both parts come together, headers first, each at its part', () => {
    const shape = rejectionShapeOf(rateLimited);

    const parsed = parsedShapeOf(shape, {
      headers: { 'retry-after': -1 },
      body: { limit: 'many' },
    });

    expect(parsed).toMatchObject({
      kind: 'issues',
      issues: [
        { part: 'headers', path: ['retry-after'], code: 'too_small' },
        { part: 'body', path: ['limit'], code: 'invalid_type' },
      ],
    });
  });

  test('a header that cannot travel as field text is an Issue at the headers part', () => {
    const shape = rejectionShapeOf(unauthenticated);

    const parsed = parsedShapeOf(shape, {
      headers: { 'www-authenticate': 'Bearer\nrealm' },
      body: undefined,
    });

    expect(parsed).toEqual({
      kind: 'issues',
      issues: [
        {
          part: 'headers',
          path: ['www-authenticate'],
          code: 'invalid_format',
          message: expect.any(String),
        },
      ],
    });
  });
});

describe('writtenShapeOf', () => {
  const readers = providedRejection({
    code: 'STAGED',
    status: 409,
    message: 'Staged',
    headers: z.object({ 'x-stage': openEnumReader(['pending']) }),
    body: z.object({ stage: openEnumReader(['pending']) }),
  });

  test('each declared part is written back through its Reader, an Unknown case as its text', () => {
    const shape = rejectionShapeOf(readers);

    const written = writtenShapeOf(shape, {
      headers: { 'x-stage': { unknown: 'lost' } },
      body: { stage: { unknown: 'lost' } },
    });

    expect(written).toEqual({
      kind: 'value',
      value: { headers: { 'x-stage': 'lost' }, body: { stage: 'lost' } },
    });
  });

  test('a value given where the shape declares none is an Issue at that part', () => {
    const shape = rejectionShapeOf(gone);

    const written = writtenShapeOf(shape, { headers: undefined, body: { x: 1 } });

    expect(written).toEqual({
      kind: 'issues',
      issues: [{ part: 'body', path: [], code: 'invalid_type', message: 'Expected no value' }],
    });
  });

  test('a header that cannot travel as field text is an Issue at the headers part', () => {
    const shape = rejectionShapeOf(unauthenticated);

    const written = writtenShapeOf(shape, {
      headers: { 'www-authenticate': ' padded' },
      body: undefined,
    });

    expect(written).toMatchObject({
      kind: 'issues',
      issues: [{ part: 'headers', path: ['www-authenticate'], code: 'invalid_format' }],
    });
  });
});

describe('readShapeOf', () => {
  test('the parts the shape declares come back read, those it declares none of ignored whatever arrived', () => {
    const shape = rejectionShapeOf(unauthenticated);

    const read = readShapeOf(shape, {
      headers: { 'www-authenticate': 'Bearer' },
      body: { why: 1 },
    });

    expect(read).toStrictEqual({
      kind: 'value',
      value: { headers: { 'www-authenticate': 'Bearer' } },
    });
  });

  test('a shape that declares nothing reads to nothing', () => {
    const shape = rejectionShapeOf(gone);

    const read = readShapeOf(shape, { headers: { a: 'b' }, body: { why: 1 } });

    expect(read).toStrictEqual({ kind: 'value', value: {} });
  });

  test('the Issues of both parts come together, each at its part', () => {
    const shape = rejectionShapeOf(rateLimited);

    const read = readShapeOf(shape, { headers: {}, body: { limit: 'many' } });

    expect(read).toMatchObject({
      kind: 'issues',
      issues: [
        { part: 'headers', path: ['retry-after'], code: 'required' },
        { part: 'body', path: ['limit'], code: 'invalid_type' },
      ],
    });
  });
});
