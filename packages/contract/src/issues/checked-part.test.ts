import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { openEnumReader } from '../index.ts';
import { parsedPartOf, writtenPartOf } from '../internal/index.ts';

const expectedNoValue = { code: 'invalid_type', message: 'Expected no value' } as const;

describe('parsedPartOf and writtenPartOf', () => {
  test.each([
    ['parsedPartOf', parsedPartOf],
    ['writtenPartOf', writtenPartOf],
  ])('%s with no schema takes no value', (_name, checkedPartOf) => {
    const checked = checkedPartOf('body', undefined, { value: undefined });

    expect(checked).toEqual({ kind: 'value', value: undefined });
  });

  test.each([
    ['parsedPartOf', parsedPartOf],
    ['writtenPartOf', writtenPartOf],
  ])('%s with no schema refuses a value, at the place given', (_name, checkedPartOf) => {
    const checked = checkedPartOf('success.body', undefined, { value: { x: 1 }, at: ['inner'] });

    expect(checked).toEqual({
      kind: 'issues',
      issues: [{ part: 'success.body', path: ['inner'], ...expectedNoValue }],
    });
  });

  test('an Issue carries the part, and the place given before its own path', () => {
    const schema = z.object({ amount: z.int() });

    const checked = parsedPartOf('body', schema, { value: { amount: 'x' }, at: ['outer'] });

    expect(checked).toMatchObject({
      kind: 'issues',
      issues: [{ part: 'body', path: ['outer', 'amount'], code: 'invalid_type' }],
    });
  });

  test('writtenPartOf writes an Unknown case back as its text', () => {
    const reader = z.object({ stage: openEnumReader(['pending']) });

    const checked = writtenPartOf('body', reader, { value: { stage: { unknown: 'refunded' } } });

    expect(checked).toEqual({ kind: 'value', value: { stage: 'refunded' } });
  });
});
