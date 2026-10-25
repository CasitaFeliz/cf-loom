import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { walkSchemas } from '../internal/index.ts';

function noOrigin() {
  return undefined;
}

function walkedAt(at: readonly (string | number)[], value: unknown) {
  return { at, walked: { kind: 'walked', value } };
}

describe('walkSchemas', () => {
  test('every location walks on its own: one that fails hides nothing of the others', () => {
    const order = z.object({ placedAt: z.date(), tags: z.array(z.string().trim()) });
    const inputAt = ['endpoints', 'POST /orders', 'input', 'body'];
    const successAt = ['endpoints', 'POST /orders', 'success', 'body'];

    const walked = walkSchemas(
      [
        { at: inputAt, schema: order },
        { at: successAt, schema: z.any() },
        { at: ['endpoints', 'GET /orders', 'success', 'body'], schema: z.array(z.uuid()) },
      ],
      noOrigin,
    );

    expect(walked).toEqual({
      located: [
        {
          at: inputAt,
          walked: {
            kind: 'not-allowed',
            failures: [
              {
                kind: 'not-allowed',
                at: [...inputAt, 'fields', 'placedAt'],
                construct: 'z.date()',
                instead: 'z.iso.datetime()',
              },
              {
                kind: 'not-allowed',
                at: [...inputAt, 'fields', 'tags', 'items'],
                construct: '.trim(), .toLowerCase(), .toUpperCase(), .normalize() or .overwrite()',
              },
            ],
          },
        },
        {
          at: successAt,
          walked: {
            kind: 'not-allowed',
            failures: [
              {
                kind: 'not-allowed',
                at: successAt,
                construct: 'z.any()',
                instead: 'z.record() or z.json()',
              },
            ],
          },
        },
        walkedAt(['endpoints', 'GET /orders', 'success', 'body'], {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
        }),
      ],
      defs: {},
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

    const moneyNode = {
      type: 'object',
      mode: 'open',
      fields: {
        amount: { required: true, schema: { type: 'number', int: true } },
        currency: { required: true, schema: { type: 'enum', values: ['eur', 'usd'], open: false } },
      },
    };
    expect(walked).toEqual({
      located: [walkedAt(['body'], moneyNode), walkedAt(['success'], moneyNode)],
      defs: {},
    });
  });

  test('enum values and allOf items are in canonical order', () => {
    const status = z.enum(['shipped', 'paid', 'pending']);
    const code = z.intersection(z.string().regex(/^[A-Z]/), z.string().max(8));

    const walked = walkSchemas(
      [
        { at: ['status'], schema: status },
        { at: ['code'], schema: code },
      ],
      noOrigin,
    );

    expect(walked).toEqual({
      located: [
        walkedAt(['status'], { type: 'enum', values: ['paid', 'pending', 'shipped'], open: false }),
        walkedAt(['code'], {
          type: 'allOf',
          items: [
            { type: 'string', max: 8 },
            { type: 'string', regex: { source: '^[A-Z]', flags: '' } },
          ],
        }),
      ],
      defs: {},
    });
  });

  test('a check without a constructor is a zod this walker does not support, a bug to report', () => {
    const name = z.string().min(1);
    const [check] = name._zod.def.checks ?? [];
    Reflect.deleteProperty(check?._zod ?? {}, 'constr');

    expect(() => walkSchemas([{ at: ['body'], schema: name }], noOrigin)).toThrow(
      /newer than cf-loom supports/,
    );
  });
});
