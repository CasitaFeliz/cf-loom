import * as built from '@casitafeliz/loom-contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import * as contract from '../index.ts';
import { isOpen } from '../internal/index.ts';

type Status = ReturnType<typeof contract.openEnum<readonly ['pending', 'paid']>>;

describe('openEnum', () => {
  test('openEnum is open and its writer type is the declared values', () => {
    const status = contract.openEnum(['pending', 'paid']);

    expect(isOpen(status)).toBe(true);
    expect(isOpen(z.enum(['pending', 'paid']))).toBe(false);
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

    expect(isOpen(described(status))).toBe(true);
  });

  test('a described z.enum() stays closed', () => {
    expect(isOpen(z.enum(['pending', 'paid']).describe('The order status'))).toBe(false);
  });

  test('openEnum takes string values only', () => {
    // @ts-expect-error an Open Enum's values are strings
    const declare = () => contract.openEnum([1, 2]);

    expect(declare).not.toThrow();
  });
});

describe('the entry', () => {
  test('openUnion is not exported', () => {
    expectTypeOf(contract).not.toHaveProperty('openUnion');
    expect(contract).not.toHaveProperty('openUnion');
    expect(built).not.toHaveProperty('openUnion');
  });
});

describe('openness from another copy of loom-contract', () => {
  test('an openEnum from another copy is open', () => {
    const status = built.openEnum(['pending', 'paid']);

    expect(isOpen(status)).toBe(true);
  });
});
