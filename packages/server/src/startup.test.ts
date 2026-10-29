import {
  defineApplication,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Endpoint,
} from '@cf-loom/contract';
import { admit, handle, success } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { serve } from './index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
});

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
  lifecycle: 'deprecated',
  deprecatedAt: '2026-10-17T09:30:00Z',
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

const handlers = {
  endpoints: {
    getOrder: handle(getOrder, () => success(getOrder)),
    findOrder: handle(findOrder, () => success(findOrder)),
  },
  guards: { apiKey: handle(apiKey, () => admit(apiKey)) },
};

describe('serve: what it checks before the first request', () => {
  test('a Service assembled as its Contract says is served; a Retired Endpoint needs no Handler, an extra key is ignored', () => {
    const extra = {
      ...handlers,
      endpoints: { ...handlers.endpoints, other: handlers.endpoints.getOrder },
    };

    const http = serve(contract, extra, {});

    expect(typeof http).toBe('function');
  });

  test('a Root that is no Service’s Contract throws', () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [] });

    const serving = () => serve(application as never, handlers, {});

    expect(serving).toThrow("serve() takes a Service's Contract declared with defineService");
  });

  test('a live Endpoint without a Handler throws, naming it', () => {
    const missing = { ...handlers, endpoints: { getOrder: handlers.endpoints.getOrder } };

    // @ts-expect-error TS2345 findOrder has no Handler
    const serving = () => serve(contract, missing, {});

    expect(serving).toThrow(
      'endpoints.findOrder has no Handler in the Handler map: run cf-loom generate',
    );
  });

  test('a Handler written for another Endpoint throws, naming the Endpoint', () => {
    const swapped = {
      ...handlers,
      endpoints: { ...handlers.endpoints, findOrder: handlers.endpoints.getOrder },
    };

    // @ts-expect-error TS2345 findOrder holds the Handler of getOrder
    const serving = () => serve(contract, swapped, {});

    expect(serving).toThrow('endpoints.findOrder holds the Handler written for getOrder');
  });

  test('a value handle() did not return throws, naming the Endpoint', () => {
    const lookalike = Object.assign(() => undefined, { declaration: findOrder });
    const forged = { ...handlers, endpoints: { ...handlers.endpoints, findOrder: lookalike } };

    // @ts-expect-error TS2345 a wrapper is no Handler handle() returned
    const serving = () => serve(contract, forged, {});

    expect(serving).toThrow(
      'endpoints.findOrder holds a value handle() did not return: wrap inside the implementation instead',
    );
  });

  test('a Handler written for another copy of the Endpoint throws, asking whether it was loaded twice', () => {
    const copy = defineEndpoint({
      name: 'findOrder',
      method: 'GET',
      path: '/orders/find',
      visibility: 'public',
      description: 'Finds an order',
      lifecycle: 'deprecated',
      deprecatedAt: '2026-10-17T09:30:00Z',
      success: { status: 204 },
    });
    const copied = {
      ...handlers,
      endpoints: { ...handlers.endpoints, findOrder: handle(copy, () => success(copy)) },
    };

    const serving = () => serve(contract, copied, {});

    expect(serving).toThrow(
      'endpoints.findOrder holds a Handler written for another copy of findOrder: is @cf-loom/contract or the Contract loaded twice?',
    );
  });

  test('a Guard a live Endpoint attaches without a Handler throws, naming it', () => {
    const missing = { ...handlers, guards: {} };

    // @ts-expect-error TS2345 apiKey has no Handler
    const serving = () => serve(contract, missing, {});

    expect(serving).toThrow(
      'guards.apiKey has no Handler in the Handler map: run cf-loom generate',
    );
  });

  test.each([
    [
      'params that are not exactly the path’s names',
      { path: '/orders/:orderId', input: { params: z.object({ id: z.string() }) as never } },
      'exact-params',
    ],
    [
      'a Success header name the host owns',
      {
        success: {
          status: 200,
          headers: z.object({ 'content-type': z.string() }),
          body: z.object({}),
        },
      },
      'header-names',
    ],
    [
      'an Input header the Fetch standard keeps for the user agent',
      { input: { headers: z.object({ cookie: z.string() }) } },
      'header-names',
    ],
    [
      'a Success header a browser hides',
      {
        success: {
          status: 200,
          headers: z.object({ 'set-cookie': z.string() }),
          body: z.object({}),
        },
      },
      'header-names',
    ],
  ])('an Endpoint with %s throws, as generate words it', (_case, written, rule) => {
    const odd = defineEndpoint({
      name: 'odd',
      method: 'GET',
      path: '/odd',
      visibility: 'public',
      description: 'An odd one',
      success: { status: 204 },
      ...(written as object),
    } as never) as Endpoint;
    const withOdd = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [odd] })],
    });

    const serving = () =>
      serve(
        withOdd,
        {
          endpoints: { odd: handle(odd, () => success(odd)) },
          guards: {},
        },
        {},
      );

    expect(serving).toThrow(` ${rule}: `);
  });

  test('an Endpoint that answers a Rejection with a header name the host owns throws, as generate words it', () => {
    const clobbering = defineRejection({
      code: 'CLOBBERING',
      status: 409,
      message: 'It clobbers the Envelope’s content type',
      headers: z.object({ 'content-type': z.string() }),
    });
    const odd = defineEndpoint({
      name: 'odd',
      method: 'GET',
      path: '/odd',
      visibility: 'public',
      description: 'An odd one',
      success: { status: 204 },
      rejections: [clobbering],
    });
    const withOdd = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [odd] })],
    });

    const serving = () =>
      serve(withOdd, { endpoints: { odd: handle(odd, () => success(odd)) }, guards: {} }, {});

    expect(serving).toThrow(' header-names: ');
  });

  test('a header an Endpoint and its Guard declare with two shapes throws, as generate words it', () => {
    const tenant = defineGuard({
      name: 'tenant',
      description: 'A tenant',
      demands: { headers: z.object({ 'x-tenant': z.number() }) },
    });
    const listed = defineEndpoint({
      name: 'listed',
      method: 'GET',
      path: '/listed',
      visibility: 'public',
      description: 'Lists',
      guards: [tenant],
      input: { headers: z.object({ 'x-tenant': z.string() }) },
      success: { status: 204 },
    });
    const withListed = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [listed] })],
    });

    const serving = () =>
      serve(
        withListed,
        {
          endpoints: { listed: handle(listed, () => success(listed)) },
          guards: { tenant: handle(tenant, () => admit(tenant)) },
        },
        {},
      );

    expect(serving).toThrow(' input-conflict: ');
  });

  test('a query param whose enum values share a text throws, as generate words it', () => {
    const versioned = defineEndpoint({
      name: 'versioned',
      method: 'GET',
      path: '/versioned',
      visibility: 'public',
      description: 'By version',
      input: { query: z.object({ v: z.literal([1, '1']) }) },
      success: { status: 204 },
    });
    const withVersioned = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [versioned] })],
    });

    const serving = () =>
      serve(
        withVersioned,
        { endpoints: { versioned: handle(versioned, () => success(versioned)) }, guards: {} },
        {},
      );

    expect(serving).toThrow(
      ' shared-text: A query param\'s values each have a text of their own: v has "1" and 1',
    );
  });

  test('a header literal that cannot travel throws, as generate words it', () => {
    const versioned = defineEndpoint({
      name: 'versioned',
      method: 'GET',
      path: '/versioned',
      visibility: 'public',
      description: 'By version',
      input: { headers: z.object({ 'x-version': z.literal([' 1', 'é\n']) }) },
      success: { status: 204 },
    });
    const withVersioned = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [versioned] })],
    });

    const serving = () =>
      serve(
        withVersioned,
        { endpoints: { versioned: handle(versioned, () => success(versioned)) }, guards: {} },
        {},
      );

    expect(serving).toThrow(
      ' unsendable-text: A header\'s values each travel as HTTP field text: x-version has " 1" and "é\\n"',
    );
  });

  test('a Handler the map only inherits is no Handler', () => {
    const inheriting: typeof handlers.endpoints = Object.create(handlers.endpoints);
    const inherited = { ...handlers, endpoints: inheriting };

    const serving = () => serve(contract, inherited, {});

    expect(serving).toThrow(
      'endpoints.getOrder has no Handler in the Handler map: run cf-loom generate',
    );
  });

  test('a GuardHandler written for another Guard throws, naming the Guard', () => {
    const swapped = { ...handlers, guards: { apiKey: handle(legacyKey, () => admit(legacyKey)) } };

    // @ts-expect-error TS2345 apiKey holds the Handler of legacyKey
    const serving = () => serve(contract, swapped, {});

    expect(serving).toThrow('guards.apiKey holds the Handler written for legacyKey');
  });

  test('a text part that holds no zod schema throws, as generate words it', () => {
    const lookup = defineEndpoint({
      name: 'lookup',
      method: 'GET',
      path: '/lookup',
      visibility: 'public',
      description: 'Looks one up',
      input: { query: { term: z.string() } as never },
      success: { status: 204 },
    });
    const withLookup = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [lookup] })],
    });

    const serving = () =>
      serve(
        withLookup,
        {
          endpoints: { lookup: handle(lookup, () => success(lookup)) },
          guards: {},
        },
        {},
      );

    expect(serving).toThrow('endpoints.GET /lookup (lookup) input.query not-a-schema');
  });

  test('a text part the walker refuses throws, as generate words it', () => {
    const since = defineEndpoint({
      name: 'since',
      method: 'GET',
      path: '/since',
      visibility: 'public',
      description: 'Since a day',
      input: { query: z.object({ at: z.date() as never }) },
      success: { status: 204 },
    });
    const withSince = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [since] })],
    });

    const serving = () =>
      serve(
        withSince,
        {
          endpoints: { since: handle(since, () => success(since)) },
          guards: {},
        },
        {},
      );

    expect(serving).toThrow('endpoints.GET /since (since) input.query.at not allowed: z.date()');
  });

  test('a text part that is no object throws, as generate words it', () => {
    const lookup = defineEndpoint({
      name: 'lookup',
      method: 'GET',
      path: '/lookup',
      visibility: 'public',
      description: 'Looks one up',
      input: { query: z.string() as never },
      success: { status: 204 },
    });
    const withLookup = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [lookup] })],
    });

    const serving = () =>
      serve(
        withLookup,
        {
          endpoints: { lookup: handle(lookup, () => success(lookup)) },
          guards: {},
        },
        {},
      );

    expect(serving).toThrow('endpoints.GET /lookup (lookup) input.query not-an-object-schema');
  });
});
