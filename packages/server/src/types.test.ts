import { defineEndpoint, defineGroup, defineGuard, defineService } from '@cf-loom/contract';
import { admit, handle, success, type WithResources } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { serve } from './index.ts';

const apiKey = defineGuard({ name: 'apiKey', description: 'A key per Caller' });

const legacyKey = defineGuard({ name: 'legacyKey', description: 'An old key' });

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'The orders',
  guards: [apiKey],
  success: { status: 204 },
});

const findOrder = defineEndpoint({
  name: 'findOrder',
  method: 'GET',
  path: '/orders/find',
  visibility: 'public',
  description: 'Finds an order',
  success: { status: 204 },
});

const oldOrders = defineEndpoint({
  name: 'oldOrders',
  method: 'GET',
  path: '/old-orders',
  visibility: 'public',
  description: 'The old orders',
  lifecycle: 'retired',
  guards: [legacyKey],
  success: { status: 204 },
});

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [getOrder, findOrder, oldOrders],
    }),
  ],
});

const getOrderHandler = handle(getOrder, () => success());
const findOrderHandler = handle(findOrder, () => success());
const apiKeyHandler = handle(apiKey, () => admit());

describe('serve: the Handler map, typed by the Contract', () => {
  test('a map that lacks an Endpoint’s Handler is a type error', () => {
    const serving = () =>
      serve(contract, {
        // @ts-expect-error findOrder has no Handler
        endpoints: { getOrder: getOrderHandler },
        guards: { apiKey: apiKeyHandler },
        deprecatedAt: {},
      });

    expect(serving).toBeTypeOf('function');
  });

  test('a map that lacks a Guard an Endpoint attaches is a type error', () => {
    const serving = () =>
      serve(contract, {
        endpoints: { getOrder: getOrderHandler, findOrder: findOrderHandler },
        // @ts-expect-error apiKey has no Handler
        guards: {},
        deprecatedAt: {},
      });

    expect(serving).toBeTypeOf('function');
  });

  test('another Endpoint’s Handler under a key is a type error', () => {
    const serving = () =>
      serve(contract, {
        // @ts-expect-error findOrder holds getOrder's Handler
        endpoints: { getOrder: getOrderHandler, findOrder: getOrderHandler },
        guards: { apiKey: apiKeyHandler },
        deprecatedAt: {},
      });

    expect(serving).toBeTypeOf('function');
  });

  test('a wrapper that carries an element is a type error', () => {
    const wrapped = Object.assign(() => findOrderHandler({}, {}), { element: findOrder });

    const serving = () =>
      serve(contract, {
        // @ts-expect-error a wrapper is no Handler handle() returned
        endpoints: { getOrder: getOrderHandler, findOrder: wrapped },
        guards: { apiKey: apiKeyHandler },
        deprecatedAt: {},
      });

    expect(serving).toBeTypeOf('function');
  });

  test('a Retired Endpoint needs no Handler, and a map spread from a variable may hold an extra key', () => {
    const endpoints = { getOrder: getOrderHandler, findOrder: findOrderHandler };
    const handlers = { endpoints, guards: { apiKey: apiKeyHandler }, deprecatedAt: {} };
    const extra = { ...handlers, endpoints: { ...endpoints, other: getOrderHandler } };

    const served = [serve(contract, handlers), serve(contract, extra)];

    expect(served).toHaveLength(2);
  });

  test('a Guard only a Retired Endpoint attaches may be in an inline map, or left out', () => {
    const endpoints = { getOrder: getOrderHandler, findOrder: findOrderHandler };

    const served = [
      serve(contract, {
        endpoints,
        guards: { apiKey: apiKeyHandler, legacyKey: handle(legacyKey, () => admit()) },
        deprecatedAt: {},
      }),
      serve(contract, { endpoints, guards: { apiKey: apiKeyHandler }, deprecatedAt: {} }),
    ];

    expect(served).toHaveLength(2);
  });

  test('a Handler whose Resources are any makes resources name the cause', () => {
    // biome-ignore lint/suspicious/noExplicitAny: the any this test is about
    const loose = handle(findOrder, async (_input, _call, { resources }: WithResources<any>) => {
      await resources.ready;
      return success();
    });
    const handlers = {
      endpoints: { getOrder: getOrderHandler, findOrder: loose },
      guards: { apiKey: apiKeyHandler },
      deprecatedAt: {},
    };

    const serving = () => [
      // @ts-expect-error the Resources of findOrder are any
      serve(contract, handlers),
      // @ts-expect-error the Resources of findOrder are any
      serve(contract, handlers, { resources: { orders: {} } }),
    ];

    expect(serving).toBeTypeOf('function');
  });
});
