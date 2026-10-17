import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineEndpoint, invalidInput, notFound, notImplemented } from './index.ts';

describe('the Standard Rejections', () => {
  test('the Standard Rejections are the same values everywhere they are imported', async () => {
    const reimported = await import('./index.ts');

    const getOrder = defineEndpoint({
      name: 'getOrder',
      method: 'GET',
      path: '/orders',
      visibility: 'public',
      description: 'Orders',
      success: { status: 200, body: z.object({}) },
      rejections: [reimported.notFound],
    });

    expect(getOrder.rejections?.[0]).toBe(notFound);
    expect(reimported.invalidInput).toBe(invalidInput);
    expect(reimported.notImplemented).toBe(notImplemented);
    expect(Object.isFrozen(notFound)).toBe(true);
  });
});
