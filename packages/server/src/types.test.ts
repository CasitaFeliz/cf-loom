import { defineEndpoint, defineGroup, defineGuard, defineService } from '@cf-loom/contract';
import {
  admit,
  type HandledBy,
  type HandlerMapOf,
  handle,
  type NoResources,
  type ResourcesOf,
  readersOf,
  success,
  type WithResources,
} from '@cf-loom/handlers';
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
      serve(
        contract,
        {
          // @ts-expect-error findOrder has no Handler
          endpoints: { getOrder: getOrderHandler },
          guards: { apiKey: apiKeyHandler },
        },
        {},
      );

    expect(serving).toBeTypeOf('function');
  });

  test('a map that lacks an Endpoint’s Handler is a type error at its key when resources are passed too', () => {
    const serving = () =>
      serve(
        contract,
        {
          // @ts-expect-error findOrder has no Handler
          endpoints: { getOrder: getOrderHandler },
          guards: { apiKey: apiKeyHandler },
        },
        { resources: {} },
      );

    expect(serving).toBeTypeOf('function');
  });

  test('a map that lacks a Guard an Endpoint attaches is a type error', () => {
    const serving = () =>
      serve(
        contract,
        {
          endpoints: { getOrder: getOrderHandler, findOrder: findOrderHandler },
          // @ts-expect-error apiKey has no Handler
          guards: {},
        },
        {},
      );

    expect(serving).toBeTypeOf('function');
  });

  test('another Endpoint’s Handler under a key is a type error', () => {
    const serving = () =>
      serve(
        contract,
        {
          // @ts-expect-error findOrder holds getOrder's Handler
          endpoints: { getOrder: getOrderHandler, findOrder: getOrderHandler },
          guards: { apiKey: apiKeyHandler },
        },
        {},
      );

    expect(serving).toBeTypeOf('function');
  });

  test('a wrapper that carries an element is a type error', () => {
    const wrapped = Object.assign(() => findOrderHandler({}, {}), { element: findOrder });

    const serving = () =>
      serve(
        contract,
        {
          // @ts-expect-error a wrapper is no Handler handle() returned
          endpoints: { getOrder: getOrderHandler, findOrder: wrapped },
          guards: { apiKey: apiKeyHandler },
        },
        {},
      );

    expect(serving).toBeTypeOf('function');
  });

  test('a Retired Endpoint needs no Handler, and a map spread from a variable may hold an extra key', () => {
    const endpoints = { getOrder: getOrderHandler, findOrder: findOrderHandler };
    const handlers = { endpoints, guards: { apiKey: apiKeyHandler } };
    const extra = { ...handlers, endpoints: { ...endpoints, other: getOrderHandler } };

    const served = [serve(contract, handlers, {}), serve(contract, extra, {})];

    expect(served).toHaveLength(2);
  });

  test('a Guard only a Retired Endpoint attaches may be in an inline map, or left out', () => {
    const endpoints = { getOrder: getOrderHandler, findOrder: findOrderHandler };

    const served = [
      serve(
        contract,
        {
          endpoints,
          guards: { apiKey: apiKeyHandler, legacyKey: handle(legacyKey, () => admit()) },
        },
        {},
      ),
      serve(contract, { endpoints, guards: { apiKey: apiKeyHandler } }, {}),
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
      serve(contract, handlers, {}),
      // @ts-expect-error the Resources of findOrder are any
      serve(contract, handlers, { resources: { orders: {} } }),
    ];

    expect(serving).toBeTypeOf('function');
  });
});

describe('serve: a Handler map typed with the Service’s Resources', () => {
  type Orders = { readonly find: () => string };
  type Resources = { readonly orders: Orders };
  type Alien = { readonly db: number };
  const resources: Resources = { orders: { find: () => 'o-1' } };
  const readers = readersOf({ commands: {}, subscriptions: {} });
  const ordersHandler = handle(
    findOrder,
    (_input, _call, { resources: taken }: WithResources<Resources>) => {
      taken.orders.find();
      return success();
    },
  );
  const typed: HandlerMapOf<typeof contract, Resources> = {
    endpoints: { getOrder: getOrderHandler, findOrder: ordersHandler },
    guards: { apiKey: apiKeyHandler },
    commands: {},
    subscriptions: {},
    readers,
  };

  test('a map annotated HandlerMapOf of the Contract and the Resources is served with them, and refused without', () => {
    const start = (map: HandlerMapOf<typeof contract, Resources>) =>
      serve(contract, map, { resources });

    const served = [start(typed), serve(contract, typed, { resources })];
    const serving = () => [
      // @ts-expect-error the Handlers take the Service's Resources
      serve(contract, typed, {}),
      // @ts-expect-error the Handlers take the Service's Resources, orders among them
      serve(contract, typed, { resources: {} }),
    ];

    expect(served).toHaveLength(2);
    expect(serving).toBeTypeOf('function');
  });

  test('a Handler that takes a Resource the Service lacks is a type error in a map annotated with them', () => {
    const alien = handle(findOrder, (_input, _call, { resources: taken }: WithResources<Alien>) => {
      taken.db.toFixed();
      return success();
    });

    const annotated = (): HandlerMapOf<typeof contract, Resources> => ({
      ...typed,
      endpoints: {
        getOrder: getOrderHandler,
        // @ts-expect-error the Service has no db
        findOrder: alien,
      },
    });

    expect(annotated).toBeTypeOf('function');
  });

  test('a map annotated HandlerMapOf of the Contract alone, or with never, leaves its Resources unspecified: serve refuses it with or without resources', () => {
    const unspecified: HandlerMapOf<typeof contract> = typed;
    const neverMap: HandlerMapOf<typeof contract, never> = typed;
    const start = (map: HandlerMapOf<typeof contract, never>) =>
      // @ts-expect-error the helper's parameter leaves the Resources unspecified
      serve(contract, map, { resources });

    const serving = () => [
      // @ts-expect-error the annotation leaves the Resources unspecified
      serve(contract, unspecified, {}),
      // @ts-expect-error the annotation leaves the Resources unspecified
      serve(contract, unspecified, { resources }),
      // @ts-expect-error the annotation leaves the Resources unspecified
      serve(contract, neverMap, {}),
      // @ts-expect-error the annotation leaves the Resources unspecified
      serve(contract, neverMap, { resources }),
      start(neverMap),
    ];

    expect(serving).toBeTypeOf('function');
  });

  test('an Endpoint typed by its brand alone in a map is refused, in a map annotated with the Resources or inferred', () => {
    const bare: HandledBy<typeof findOrder> = ordersHandler;
    const bareNever: HandledBy<typeof findOrder, never> = ordersHandler;
    const inferred = {
      endpoints: { getOrder: getOrderHandler, findOrder: bare },
      guards: { apiKey: apiKeyHandler },
    };
    const inferredNever = {
      ...inferred,
      endpoints: { ...inferred.endpoints, findOrder: bareNever },
    };

    const annotated = (): HandlerMapOf<typeof contract, Resources> => ({
      ...typed,
      endpoints: {
        getOrder: getOrderHandler,
        // @ts-expect-error the brand alone hides what findOrder takes
        findOrder: bare,
      },
    });
    const serving = () => [
      // @ts-expect-error the brand alone hides what findOrder takes
      serve(contract, inferred, { resources }),
      // @ts-expect-error never hides what findOrder takes
      serve(contract, inferredNever, { resources }),
    ];

    expect(annotated).toBeTypeOf('function');
    expect(serving).toBeTypeOf('function');
  });

  test('a map annotated without the Resources is no map annotated with them', () => {
    const unspecified: HandlerMapOf<typeof contract> = typed;

    // @ts-expect-error the annotation left the Resources unspecified
    const widened: HandlerMapOf<typeof contract, Resources> = unspecified;

    expect(widened).toBe(typed);
  });

  test('a Service with no Resources types its map HandlerMapOf of the Contract and NoResources', () => {
    const none: HandlerMapOf<typeof contract, NoResources> = {
      endpoints: { getOrder: getOrderHandler, findOrder: findOrderHandler },
      guards: { apiKey: apiKeyHandler },
      commands: {},
      subscriptions: {},
      readers,
    };
    const start = (map: HandlerMapOf<typeof contract, NoResources>) => serve(contract, map, {});
    const takingSome = (): HandlerMapOf<typeof contract, NoResources> => ({
      ...none,
      endpoints: {
        getOrder: getOrderHandler,
        // @ts-expect-error the Service has none
        findOrder: ordersHandler,
      },
    });

    const served = [
      start(none),
      serve(contract, none, {}),
      serve(contract, none, { resources: {} }),
    ];

    expect(served).toHaveLength(3);
    expect(takingSome).toBeTypeOf('function');
  });
});

describe('serve: its options are always given', () => {
  test('a Service whose Handlers take no Resources passes {} or what is operational, never nothing', () => {
    const handlers = {
      endpoints: { getOrder: getOrderHandler, findOrder: findOrderHandler },
      guards: { apiKey: apiKeyHandler },
    };

    const served = [serve(contract, handlers, {}), serve(contract, handlers, { maxBodyBytes: 1 })];
    const serving = () => [
      // @ts-expect-error serve always takes its options
      serve(contract, handlers),
    ];

    expect(served).toHaveLength(2);
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

describe('serve: a wrapper over the Handler map', () => {
  type Clock = { readonly now: () => number };
  type Resources = { readonly clock: Clock };
  const clock: Clock = { now: () => 0 };
  const needsClock = handle(findOrder, (_input, _call, { resources }: WithResources<Resources>) => {
    resources.clock.now();
    return success();
  });
  const handlers: HandlerMapOf<typeof contract, Resources> = {
    endpoints: { getOrder: getOrderHandler, findOrder: needsClock },
    guards: { apiKey: apiKeyHandler },
    commands: {},
    subscriptions: {},
    readers: readersOf({ commands: {}, subscriptions: {} }),
  };

  test('a wrapper whose parameter is the concrete options type is accepted', () => {
    const wrapper = (
      map: HandlerMapOf<typeof contract, Resources>,
      options: ServeOptions<Resources>,
    ) => serve(contract, map, options);

    const served = wrapper(handlers, { resources: { clock } });

    expect(served).toBeTypeOf('function');
  });

  test('a wrapper generic over the Handler map is a type error, whatever its options parameter says', () => {
    type Served = Pick<HandlerMapOf<typeof contract, Resources>, 'endpoints' | 'guards'>;
    const restating = <const H extends Served>(
      map: H,
      options: ServeOptions<ResourcesOf<Pick<H, 'endpoints' | 'guards'>>>,
      // @ts-expect-error the options of a generic Handler map cannot be checked against its Resources
    ) => serve(contract, map, options);
    const naming = <const H extends Served>(
      map: H,
      options: ServeOptions<ResourcesOf<H>>,
      // @ts-expect-error the options of a generic Handler map cannot be checked against its Resources
    ) => serve(contract, map, options);

    expect([restating, naming]).toHaveLength(2);
  });
});
