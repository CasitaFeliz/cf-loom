import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineCommand } from '../index.ts';

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
