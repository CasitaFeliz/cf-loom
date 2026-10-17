import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineEndpoint, defineGroup } from './index.ts';

const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
});

describe('defineGroup', () => {
  test('a Group keeps its Endpoints by identity', () => {
    const ordersGroup = defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      endpoints: [listOrders],
    });

    expect(ordersGroup.endpoints[0]).toBe(listOrders);
    expect(ordersGroup.kind).toBe('group');
  });

  test('a Group needs at least one Endpoint', () => {
    const declare = () =>
      defineGroup({
        name: 'orders',
        description: 'Order lifecycle',
        // @ts-expect-error a Group is never empty
        endpoints: [],
      });

    expect(declare).not.toThrow();
  });
});
