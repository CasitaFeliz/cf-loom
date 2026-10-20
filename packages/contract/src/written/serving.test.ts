import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineContract, defineEndpoint, defineGroup, defineGuard } from '../index.ts';
import { attachmentsOf, endpointsOf, isInputPart, pathSegmentsOf } from '../internal/index.ts';

const userToken = defineGuard({
  name: 'userToken',
  description: 'A user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
});

const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken],
  qualifier: z.array(z.string()),
});

function anEndpoint<const Name extends string>(name: Name, path: string) {
  return defineEndpoint({
    name,
    method: 'GET',
    path,
    visibility: 'public',
    description: 'An Endpoint',
    success: { status: 204 },
  });
}

describe('endpointsOf', () => {
  test('lists each Endpoint once, in Group order', () => {
    const listOrders = anEndpoint('listOrders', '/orders');
    const getOrder = anEndpoint('getOrder', '/orders/a');
    const ping = anEndpoint('ping', '/ping');
    const contract = defineContract({
      name: 'orders-service',
      groups: [
        defineGroup({ name: 'orders', description: 'Orders', endpoints: [listOrders, getOrder] }),
        defineGroup({ name: 'health', description: 'Health', endpoints: [ping, listOrders] }),
      ],
    });

    const endpoints = endpointsOf(contract);

    expect(endpoints).toEqual([listOrders, getOrder, ping]);
  });
});

describe('attachmentsOf', () => {
  test('gives each Guard with its Qualifier, undefined when bare', () => {
    const updateOrder = defineEndpoint({
      name: 'updateOrder',
      method: 'PUT',
      path: '/orders',
      visibility: 'public',
      description: 'Changes an order',
      guards: [userToken, { guard: permission, qualifier: ['orders:edit'] }],
      success: { status: 204 },
    });

    const attachments = attachmentsOf(updateOrder);

    expect(attachments).toEqual([
      { guard: userToken, qualifier: undefined },
      { guard: permission, qualifier: ['orders:edit'] },
    ]);
  });
});

describe('pathSegmentsOf', () => {
  test('tells literals from params, and the root has none', () => {
    const segments = pathSegmentsOf('/orders/:orderId/lines');

    expect(segments).toEqual([
      { kind: 'literal', text: 'orders' },
      { kind: 'param', name: 'orderId' },
      { kind: 'literal', text: 'lines' },
    ]);
    expect(pathSegmentsOf('/')).toEqual([]);
  });
});

describe('isInputPart', () => {
  test('admits the Input and demand parts only', () => {
    const parts = [
      'input.params',
      'input.query',
      'input.headers',
      'input.body',
      'demands.headers',
      'demands.query',
      'context',
      'qualifier',
      'success.body',
      'rejections',
    ] as const;

    const admitted = parts.filter(isInputPart);

    expect(admitted).toEqual([
      'input.params',
      'input.query',
      'input.headers',
      'input.body',
      'demands.headers',
      'demands.query',
    ]);
  });
});
