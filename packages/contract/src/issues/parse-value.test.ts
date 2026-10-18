import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { parseValue } from '../internal/index.ts';

const order = z.object({ id: z.uuid(), lines: z.array(z.object({ quantity: z.int().min(1) })) });

function codesOf(schema: z.ZodType, value: unknown): readonly string[] {
  const parsed = parseValue(schema, value);
  return parsed.kind === 'issues' ? parsed.issues.map((issue) => issue.code) : [];
}

describe('parseValue', () => {
  test('a valid value comes back parsed, an open object stripped of unknown keys', () => {
    const value = { id: '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00', lines: [], extra: true };

    const parsed = parseValue(order, value);

    expect(parsed).toEqual({
      kind: 'value',
      value: { id: '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00', lines: [] },
    });
  });

  test('a failure is one issue with a nested path, cf-loom code and a message', () => {
    const value = { id: '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00', lines: [{ quantity: 0 }] };

    const parsed = parseValue(order, value);

    expect(parsed).toEqual({
      kind: 'issues',
      issues: [{ path: ['lines', 0, 'quantity'], code: 'too_small', message: expect.any(String) }],
    });
  });

  test('an issue never carries the received value', () => {
    const secret = 'the-secret-value';

    const parsed = parseValue(z.object({ id: z.uuid(), kind: z.enum(['a']) }), {
      id: secret,
      kind: secret,
    });

    expect(JSON.stringify(parsed)).not.toContain(secret);
  });

  test('a missing value is required and a value of the wrong type invalid_type', () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    const codes = codesOf(schema, { age: 'old' });

    expect(codes).toEqual(['required', 'invalid_type']);
  });

  test('a value outside an enum, a literal or a union is invalid_value', () => {
    const schema = z.object({
      status: z.enum(['paid']),
      kind: z.literal('order'),
      id: z.union([z.string(), z.number()]),
    });

    const codes = codesOf(schema, { status: 'lost', kind: 'refund', id: true });

    expect(codes).toEqual(['invalid_value', 'invalid_value', 'invalid_value']);
  });

  test('a bad format, a bound and a multiple keep their meaning', () => {
    const schema = z.object({
      email: z.email(),
      low: z.int().min(5),
      high: z.string().max(1),
      even: z.int().multipleOf(2),
    });

    const codes = codesOf(schema, { email: 'nope', low: 1, high: 'long', even: 3 });

    expect(codes).toEqual(['invalid_format', 'too_small', 'too_big', 'not_multiple']);
  });

  test('a strict object answers one unrecognized_key per key, the key on the path', () => {
    const schema = z.strictObject({ inner: z.strictObject({ id: z.string() }) });

    const parsed = parseValue(schema, { inner: { id: 'a', first: 1, second: 2 } });

    expect(parsed).toEqual({
      kind: 'issues',
      issues: [
        { path: ['inner', 'first'], code: 'unrecognized_key', message: 'Unrecognized key' },
        { path: ['inner', 'second'], code: 'unrecognized_key', message: 'Unrecognized key' },
      ],
    });
  });

  test('a record key outside its schema is invalid_value', () => {
    const schema = z.record(z.string().min(2), z.string());

    const codes = codesOf(schema, { b: 'x' });

    expect(codes).toEqual(['invalid_value']);
  });
});
