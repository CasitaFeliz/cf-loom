import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import type * as core from 'zod/v4/core';
import type { OpenEnum } from '../index.ts';
import * as contract from '../index.ts';
import { encodedValueOf, walkSchemas } from '../internal/index.ts';

type Status = ReturnType<typeof contract.openEnum<readonly ['pending', 'paid']>>;

function aPlace() {
  return { site: { kind: 'export', name: 'body' }, declaration: undefined, steps: [] } as const;
}

/** Whether the walker reads a schema as an Open Enum: its enum node's `open`, none for any other node. */
function openOf(schema: core.$ZodType): boolean | undefined {
  const { located } = walkSchemas([{ at: aPlace(), schema }], () => undefined);
  const walked = located[0]?.walked;
  const node = walked?.kind === 'walked' ? walked.value : undefined;
  return node?.type === 'enum' ? node.open : undefined;
}

describe('openEnum', () => {
  test('openEnum is open and its writer type is the declared values', () => {
    const status = contract.openEnum(['pending', 'paid']);

    expect(openOf(status)).toBe(true);
    expect(openOf(z.enum(['pending', 'paid']))).toBe(false);
    expect(status.safeParse('refunded').success).toBe(false);
    expectTypeOf<z.output<typeof status>>().toEqualTypeOf<'pending' | 'paid'>();
  });

  test.each([
    ['.describe()', (status: Status) => status.describe('The order status')],
    ['.meta()', (status: Status) => status.meta({ description: 'The order status' })],
    ['zod/mini describe', (status: Status) => status.check(zm.describe('The order status'))],
    ['zod/mini meta', (status: Status) => status.check(zm.meta({ description: 'Status' }))],
  ])('an openEnum described with %s stays open', (_name, described) => {
    const status = contract.openEnum(['pending', 'paid']);

    expect(openOf(described(status))).toBe(true);
  });

  test('a described z.enum() stays closed', () => {
    expect(openOf(z.enum(['pending', 'paid']).describe('The order status'))).toBe(false);
  });

  test('an openEnum with values excluded stays open', () => {
    const status = contract.openEnum(['pending', 'paid', 'refunded']);

    const withoutRefunded = status.exclude(['refunded']);

    expect(openOf(withoutRefunded)).toBe(true);
  });

  test('an openEnum with values extracted stays open', () => {
    const status = contract.openEnum(['pending', 'paid', 'refunded']);

    const settled = status.extract(['paid', 'refunded']);

    expect(openOf(settled)).toBe(true);
  });

  test('a described openEnum with values excluded stays open', () => {
    const status = contract.openEnum(['pending', 'paid', 'refunded']);

    const withoutRefunded = status.describe('The order status').exclude(['refunded']);

    expect(openOf(withoutRefunded)).toBe(true);
  });

  test('a z.enum() with values excluded stays closed', () => {
    const status = z.enum(['pending', 'paid', 'refunded']);

    expect(openOf(status.exclude(['refunded']))).toBe(false);
  });

  test('a z.enum() with values extracted stays closed', () => {
    const status = z.enum(['pending', 'paid', 'refunded']);

    expect(openOf(status.extract(['paid']))).toBe(false);
  });

  test('an openEnum with values excluded is typed as an Open Enum of the remaining values', () => {
    const status = contract.openEnum(['pending', 'paid']);

    expectTypeOf(status.exclude(['paid'])).toEqualTypeOf<OpenEnum<{ pending: 'pending' }>>();
  });

  test('an openEnum with values extracted is typed as an Open Enum of those values', () => {
    const status = contract.openEnum(['pending', 'paid']);

    expectTypeOf(status.extract(['pending'])).toEqualTypeOf<OpenEnum<{ pending: 'pending' }>>();
  });

  test('a described openEnum is typed as the same Open Enum', () => {
    const status = contract.openEnum(['pending', 'paid']);

    expectTypeOf(status.describe('The order status')).toEqualTypeOf(status);
  });

  test('a z.enum() is not typed as an Open Enum', () => {
    expectTypeOf(contract.openEnum(['pending'])).toExtend<OpenEnum<{ pending: 'pending' }>>();
    expectTypeOf(z.enum(['pending'])).not.toExtend<OpenEnum<{ pending: 'pending' }>>();
  });

  test('an Open Enum type names the enum it holds', () => {
    // @ts-expect-error TS2314 a bare OpenEnum would accept no Open Enum
    const bare: OpenEnum | undefined = undefined;

    expect(bare).toBeUndefined();
  });

  test('openEnum takes string values only', () => {
    // @ts-expect-error TS2322 an Open Enum's values are strings
    const declare = () => contract.openEnum([1, 2]);

    expect(declare).not.toThrow();
  });
});

describe('openEnumReader', () => {
  test('a declared value reads as itself and any other string as its Unknown case', () => {
    const stage = contract.openEnumReader(['packed', 'shipped']);

    const read = [stage.parse('shipped'), stage.parse('lost')];

    expect(read).toEqual(['shipped', { unknown: 'lost' }]);
    expect(stage.safeParse(1).success).toBe(false);
  });

  test('its type is the declared values or the Unknown case', () => {
    const stage = contract.openEnumReader(['packed', 'shipped']);

    expectTypeOf<z.output<typeof stage>>().toEqualTypeOf<
      'packed' | 'shipped' | { unknown: string }
    >();
  });

  test('a declared value and an Unknown case are written back as their text', () => {
    const stage = contract.openEnumReader(['packed', 'shipped']);

    const written = [encodedValueOf(stage, 'packed'), encodedValueOf(stage, { unknown: 'lost' })];

    expect(written).toEqual([
      { kind: 'value', value: 'packed' },
      { kind: 'value', value: 'lost' },
    ]);
  });

  test('an Unknown case holding a declared value is refused, and so is a bare unknown string', () => {
    const stage = contract.openEnumReader(['packed', 'shipped']);

    const written = [encodedValueOf(stage, { unknown: 'packed' }), encodedValueOf(stage, 'lost')];

    expect(written).toEqual([
      {
        kind: 'issues',
        issues: [
          { path: [], code: 'invalid_value', message: 'A declared value, not an Unknown case' },
        ],
      },
      {
        kind: 'issues',
        issues: [{ path: [], code: 'invalid_value', message: expect.any(String) }],
      },
    ]);
  });
});
