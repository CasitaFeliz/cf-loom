import * as built from '@casitafeliz/loom-contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import { openEnum, openUnion } from '../index.ts';
import { isOpen } from '../internal/index.ts';

type Status = ReturnType<typeof openEnum<readonly ['pending', 'paid']>>;

const card = z.object({ type: z.literal('card'), last4: z.string() });
const transfer = z.object({ type: z.literal('transfer'), iban: z.string() });

describe('openEnum', () => {
  test('openEnum is open and its writer type is the declared values', () => {
    const status = openEnum(['pending', 'paid']);

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
    const status = openEnum(['pending', 'paid']);

    expect(isOpen(described(status))).toBe(true);
  });

  test('a described z.enum() stays closed', () => {
    expect(isOpen(z.enum(['pending', 'paid']).describe('The order status'))).toBe(false);
  });

  test('openEnum takes string values only', () => {
    // @ts-expect-error an Open Enum's values are strings
    const declare = () => openEnum([1, 2]);

    expect(declare).not.toThrow();
  });
});

describe('openUnion', () => {
  test('openUnion is open and accepts only the declared variants when writing', () => {
    const payment = openUnion('type', [card, transfer]);

    expect(isOpen(payment)).toBe(true);
    expect(payment.safeParse({ type: 'card', last4: '4242' }).success).toBe(true);
    expect(payment.safeParse({ type: 'crypto', wallet: 'w' }).success).toBe(false);
    expectTypeOf<z.output<typeof payment>>().toEqualTypeOf<
      { type: 'card'; last4: string } | { type: 'transfer'; iban: string }
    >();
  });

  test('a variant whose discriminator is not a literal is a type error', () => {
    // @ts-expect-error the discriminator is a literal
    const declare = () => openUnion('type', [z.object({ type: z.string() })]);

    expect(declare).not.toThrow();
  });

  test('a variant whose discriminator is not a string literal is a type error', () => {
    // @ts-expect-error the discriminator is a string literal
    const declare = () => openUnion('type', [z.object({ type: z.literal(1) })]);

    expect(declare).not.toThrow();
  });

  test('a variant without the discriminator is a type error', () => {
    // @ts-expect-error every variant has the discriminator
    expectTypeOf(openUnion<'kind', readonly [typeof card]>).toBeFunction();
  });
});

describe('openUnion metadata', () => {
  test('an openUnion described with .describe() stays open', () => {
    const payment = openUnion('type', [card, transfer]);

    expect(isOpen(payment.describe('A payment'))).toBe(true);
  });

  test('an openUnion described with zod/mini meta stays open', () => {
    const payment = openUnion('type', [card, transfer]);

    expect(isOpen(payment.check(zm.meta({ description: 'A payment' })))).toBe(true);
  });
});

describe('openness from another copy of loom-contract', () => {
  test('an openEnum from another copy is open', () => {
    const status = built.openEnum(['pending', 'paid']);

    expect(isOpen(status)).toBe(true);
  });

  test('an openUnion from another copy is open', () => {
    const payment = built.openUnion('type', [card, transfer]);

    expect(isOpen(payment)).toBe(true);
  });
});
