import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { walkSchemas } from '../internal/index.ts';

function noOrigin() {
  return undefined;
}

describe('walkSchemas', () => {
  test('several failures in one walk are all reported, each with its location', () => {
    const order = z.object({ placedAt: z.date(), tags: z.array(z.string().trim()) });

    const walked = walkSchemas(
      [
        { at: ['endpoints', 'POST /orders', 'input', 'body'], schema: order },
        { at: ['endpoints', 'POST /orders', 'success', 'body'], schema: z.any() },
      ],
      noOrigin,
    );

    expect(walked).toEqual({
      kind: 'not-allowed',
      failures: [
        {
          at: ['endpoints', 'POST /orders', 'input', 'body', 'fields', 'placedAt'],
          construct: 'z.date()',
          instead: 'z.iso.datetime()',
        },
        {
          at: ['endpoints', 'POST /orders', 'input', 'body', 'fields', 'tags', 'items'],
          construct: '.trim(), .toLowerCase(), .toUpperCase(), .normalize() or .overwrite()',
        },
        {
          at: ['endpoints', 'POST /orders', 'success', 'body'],
          construct: 'z.any()',
          instead: 'z.record() or z.json()',
        },
      ],
    });
  });

  test('the same schema at two locations walks to equal nodes', () => {
    const money = z.object({ amount: z.int(), currency: z.enum(['usd', 'eur']) });

    const walked = walkSchemas(
      [
        { at: ['body'], schema: money },
        { at: ['success'], schema: money },
      ],
      noOrigin,
    );

    expect(walked.kind === 'walked' && walked.nodes[0]).toEqual(
      walked.kind === 'walked' && walked.nodes[1],
    );
  });

  test('enum values, union options and allOf items are in canonical order', () => {
    const status = z.enum(['shipped', 'paid', 'pending']);
    const reference = z.union([z.uuid(), z.int(), z.email()]);
    const code = z.intersection(z.string().regex(/^[A-Z]/), z.string().max(8));

    const walked = walkSchemas(
      [
        { at: ['status'], schema: status },
        { at: ['reference'], schema: reference },
        { at: ['code'], schema: code },
      ],
      noOrigin,
    );

    expect(walked).toEqual({
      kind: 'walked',
      nodes: [
        { type: 'enum', values: ['paid', 'pending', 'shipped'], open: false },
        {
          type: 'union',
          options: [
            { type: 'string', format: 'email' },
            { type: 'string', format: 'uuid' },
            { type: 'number', int: true },
          ],
        },
        {
          type: 'allOf',
          items: [
            { type: 'string', max: 8 },
            { type: 'string', regex: { source: '^[A-Z]', flags: '' } },
          ],
        },
      ],
      defs: {},
    });
  });
});
