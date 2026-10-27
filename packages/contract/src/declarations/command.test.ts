import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type BodyOf, defineCommand } from '../index.ts';

const body = z.object({ orderId: z.uuid() });

describe('defineCommand', () => {
  test('a Command keeps what was written with its kind', () => {
    const chargeCardV1 = defineCommand({
      name: 'ChargeCard',
      version: 1,
      description: 'Charges the order’s card',
      body,
    });

    expect(chargeCardV1).toEqual({
      kind: 'command',
      name: 'ChargeCard',
      version: 1,
      description: 'Charges the order’s card',
      body,
    });
    expect(chargeCardV1.body).toBe(body);
  });

  test('a Command declaring a Visibility is a type error', () => {
    const declare = () =>
      defineCommand({
        name: 'ChargeCard',
        version: 1,
        description: 'Charges the order’s card',
        body,
        // @ts-expect-error a Command is always Private
        visibility: 'private',
      });

    expect(declare).not.toThrow();
  });

  test('a body that is no object of its fields is a type error', () => {
    const base = {
      name: 'ChargeCard',
      version: 1,
      description: 'Charges the order’s card',
    } as const;
    const declare = () => [
      // @ts-expect-error a string cannot grow
      defineCommand({ ...base, body: z.string() }),
      // @ts-expect-error a list cannot grow
      defineCommand({ ...base, body: z.array(z.object({ orderId: z.uuid() })) }),
    ];

    expect(declare).not.toThrow();
  });

  test('a version that is not a whole number from 1 is a type error', () => {
    const declare = () =>
      defineCommand({
        name: 'ChargeCard',
        // @ts-expect-error versions count from 1
        version: -1,
        description: 'Charges the order’s card',
        body,
      });

    expect(declare).not.toThrow();
  });
});

describe('BodyOf', () => {
  test('BodyOf of a Command is its body schema’s output', () => {
    const chargeCardV1 = defineCommand({
      name: 'ChargeCard',
      version: 1,
      description: 'Charges the order’s card',
      body: z.object({ orderId: z.uuid(), amount: z.int() }),
    });

    expectTypeOf<BodyOf<typeof chargeCardV1>>().toEqualTypeOf<{
      orderId: string;
      amount: number;
    }>();
  });
});
