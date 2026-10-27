import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { refusalsOf } from '../../test/failures.ts';
import { type Step, walkSchemas } from '../internal/index.ts';

/** The steps down the named parts of an Endpoint, as the Check names them. */
function partsOf(...names: readonly ('input' | 'success' | 'body')[]): readonly Step[] {
  return names.map((name) => ({ kind: 'part', name }));
}

function noOrigin() {
  return undefined;
}

function exportAt(name: string) {
  return { site: { kind: 'export', name }, declaration: undefined, steps: [] } as const;
}

function endpointAt(identity: string, name: string, steps: readonly Step[]) {
  const site = { kind: 'endpoint', identity, name } as const;
  return { site, declaration: undefined, steps };
}

function walkedAs(value: unknown) {
  return { kind: 'walked', value };
}

describe('walkSchemas', () => {
  test('every location walks on its own: one that fails hides nothing of the others', () => {
    const order = z.object({ placedAt: z.date(), tags: z.array(z.string().trim()) });
    const inputAt = endpointAt('POST /orders', 'createOrder', partsOf('input', 'body'));
    const successAt = endpointAt('POST /orders', 'createOrder', partsOf('success', 'body'));
    const listedAt = endpointAt('GET /orders', 'listOrders', partsOf('success', 'body'));

    const walked = walkSchemas(
      [
        { at: inputAt, schema: order },
        { at: successAt, schema: z.any() },
        { at: listedAt, schema: z.array(z.uuid()) },
      ],
      noOrigin,
    );

    expect(refusalsOf(walked)).toEqual({
      located: [
        {
          kind: 'not-allowed',
          failures: [
            {
              kind: 'not-allowed',
              at: 'input.body.placedAt',
              construct: 'z.date()',
              instead: 'z.iso.datetime()',
            },
            {
              kind: 'not-allowed',
              at: 'input.body.tags[]',
              construct:
                '.trim(), .toLowerCase(), .toUpperCase(), .normalize(), .slugify() or .overwrite()',
            },
          ],
        },
        {
          kind: 'not-allowed',
          failures: [
            {
              kind: 'not-allowed',
              at: 'success.body',
              construct: 'z.any()',
              instead: 'z.record() or z.json()',
            },
          ],
        },
        walkedAs({ type: 'array', items: { type: 'string', format: 'uuid' } }),
      ],
      defs: {},
    });
    expect(walked.located.map(({ at }) => at)).toEqual([inputAt, successAt, listedAt]);
  });

  test('the same schema at two locations walks to equal nodes', () => {
    const money = z.object({ amount: z.int(), currency: z.enum(['usd', 'eur']) });

    const walked = walkSchemas(
      [
        { at: exportAt('body'), schema: money },
        { at: exportAt('success'), schema: money },
      ],
      noOrigin,
    );

    const moneyNode = {
      type: 'object',
      fields: {
        amount: { required: true, schema: { type: 'number', int: true } },
        currency: { required: true, schema: { type: 'enum', values: ['eur', 'usd'], open: false } },
      },
    };
    expect(refusalsOf(walked)).toEqual({
      located: [walkedAs(moneyNode), walkedAs(moneyNode)],
      defs: {},
    });
  });

  test('enum values and allOf items are in canonical order', () => {
    const status = z.enum(['shipped', 'paid', 'pending']);
    const code = z.intersection(z.string().regex(/^[A-Z]/), z.string().max(8));

    const walked = walkSchemas(
      [
        { at: exportAt('status'), schema: status },
        { at: exportAt('code'), schema: code },
      ],
      noOrigin,
    );

    expect(refusalsOf(walked)).toEqual({
      located: [
        walkedAs({ type: 'enum', values: ['paid', 'pending', 'shipped'], open: false }),
        walkedAs({
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

    expect(() => walkSchemas([{ at: exportAt('body'), schema: name }], noOrigin)).toThrow(
      /newer than cf-loom supports/,
    );
  });
});
