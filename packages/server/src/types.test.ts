import { defineEndpoint, defineGroup, defineGuard, defineService } from '@cf-loom/contract';
import { admit, handle, success, type WithResources } from '@cf-loom/handlers';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { type ServeOptions, serve } from './index.ts';

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
      });

    expect(serving).toBeTypeOf('function');
  });

  test('a map that lacks a Guard an Endpoint attaches is a type error', () => {
    const serving = () =>
      serve(contract, {
        endpoints: { getOrder: getOrderHandler, findOrder: findOrderHandler },
        // @ts-expect-error apiKey has no Handler
        guards: {},
      });

    expect(serving).toBeTypeOf('function');
  });

  test('another Endpoint’s Handler under a key is a type error', () => {
    const serving = () =>
      serve(contract, {
        // @ts-expect-error findOrder holds getOrder's Handler
        endpoints: { getOrder: getOrderHandler, findOrder: getOrderHandler },
        guards: { apiKey: apiKeyHandler },
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
      });

    expect(serving).toBeTypeOf('function');
  });

  test('a Retired Endpoint needs no Handler, and a map spread from a variable may hold an extra key', () => {
    const endpoints = { getOrder: getOrderHandler, findOrder: findOrderHandler };
    const handlers = { endpoints, guards: { apiKey: apiKeyHandler } };
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
      }),
      serve(contract, { endpoints, guards: { apiKey: apiKeyHandler } }),
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

describe('serve: the options, typed by what they declare', () => {
  const clock = { now: () => 0 };
  const needsClock = handle(
    findOrder,
    (_input, _call, { resources }: WithResources<{ clock: typeof clock }>) => {
      resources.clock.now();
      return success();
    },
  );
  const handlers = {
    endpoints: { getOrder: getOrderHandler, findOrder: findOrderHandler },
    guards: { apiKey: apiKeyHandler },
  };
  const handlersWithClock = {
    endpoints: { getOrder: getOrderHandler, findOrder: needsClock },
    guards: { apiKey: apiKeyHandler },
  };

  test('an options variable holding resources and a misspelled maxBodyBytes is a type error', () => {
    const options = { resources: { clock }, maxBodyByte: 1_048_576 };

    // @ts-expect-error maxBodyByte is not a declared field
    const serving = () => serve(contract, handlersWithClock, options);

    expect(serving).toBeTypeOf('function');
  });

  test('an options variable holding a declared hook and a misspelled one is a type error', () => {
    const options = { onAnswered: () => undefined, onAnswerd: () => undefined };

    // @ts-expect-error onAnswerd is not a declared field
    const serving = () => serve(contract, handlers, options);

    expect(serving).toBeTypeOf('function');
  });

  test('an options variable holding only declared fields is accepted', () => {
    const options = { resources: { clock }, maxBodyBytes: 1_048_576, onAnswered: () => undefined };
    const typed: ServeOptions<{ clock: typeof clock }> = { resources: { clock } };

    const served = [
      serve(contract, handlersWithClock, options),
      serve(contract, handlersWithClock, typed),
    ];

    expect(served).toHaveLength(2);
  });

  test('an options variable holding no resources is accepted when no Handler takes any', () => {
    const options = { maxBodyBytes: 'unlimited' } as const;
    const typed: ServeOptions = {};

    const served = [serve(contract, handlers, options), serve(contract, handlers, typed)];

    expect(served).toHaveLength(2);
  });

  test('a hook written inline in the options gets its parameter types', () => {
    const served = serve(contract, handlers, {
      onAnswered: (answered, request) => {
        expectTypeOf(answered.status).toEqualTypeOf<number>();
        expectTypeOf(request).toEqualTypeOf<Request>();
      },
      onServiceFault: (fault, request) => {
        expectTypeOf(fault.kind).toBeString();
        expectTypeOf(request).toEqualTypeOf<Request>();
      },
    });

    expect(served).toBeTypeOf('function');
  });

  test('options that may be undefined are accepted when no Handler takes Resources', () => {
    const forwarding = (options?: ServeOptions) => serve(contract, handlers, options);
    const maybe = undefined as ServeOptions | undefined;

    const served = [
      serve(contract, handlers, undefined),
      serve(contract, handlers, maybe),
      forwarding(),
      forwarding({ maxBodyBytes: 1_024 }),
    ];

    expect(served).toHaveLength(4);
  });

  test('resources are still required when a Handler takes them, given through a variable too', () => {
    const options = { maxBodyBytes: 1_024 };
    const mistyped = { resources: { clock: 'tick' } };

    const serving = () => [
      // @ts-expect-error findOrder's Handler takes the clock
      serve(contract, handlersWithClock, options),
      // @ts-expect-error the clock is not what findOrder's Handler takes
      serve(contract, handlersWithClock, mistyped),
    ];

    expect(serving).toBeTypeOf('function');
  });
});
