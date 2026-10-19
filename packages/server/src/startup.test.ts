import {
  defineApplication,
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
} from '@casitafeliz/loom-contract';
import { admit, handle, success } from '@casitafeliz/loom-handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { serve } from './index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per client',
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

const contract = defineContract({
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
    getOrder: handle(getOrder, () => success()),
    findOrder: handle(findOrder, () => success()),
  },
  guards: { apiKey: handle(apiKey, () => admit()) },
  deprecatedAt: { findOrder: '2026-10-17T09:30:00Z' },
};

describe('serve: what it checks before the first request', () => {
  test('a Service assembled as its Contract says is served; a Retired Endpoint needs no Handler, an extra key is ignored', () => {
    const extra = {
      ...handlers,
      endpoints: { ...handlers.endpoints, other: handlers.endpoints.getOrder },
    };

    const http = serve(contract, extra);

    expect(typeof http).toBe('function');
  });

  test('a root that is no Contract throws', () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [] });

    const serving = () => serve(application as never, handlers);

    expect(serving).toThrow('serve() takes a Contract declared with defineContract');
  });

  test('a live Endpoint without a Handler throws, naming it', () => {
    const missing = { ...handlers, endpoints: { getOrder: handlers.endpoints.getOrder } };

    const serving = () => serve(contract, missing);

    expect(serving).toThrow('endpoints.findOrder has no Handler in the Handler map');
  });

  test('a Handler written for another Endpoint throws, naming the Endpoint', () => {
    const swapped = {
      ...handlers,
      endpoints: { ...handlers.endpoints, findOrder: handlers.endpoints.getOrder },
    };

    const serving = () => serve(contract, swapped as never);

    expect(serving).toThrow(
      'endpoints.findOrder holds no Handler handle() returned for it: run cf-loom generate',
    );
  });

  test('a value handle() did not return throws, naming the Endpoint', () => {
    const lookalike = Object.assign(() => undefined, { element: findOrder });
    const forged = { ...handlers, endpoints: { ...handlers.endpoints, findOrder: lookalike } };

    const serving = () => serve(contract, forged);

    expect(serving).toThrow('endpoints.findOrder holds no Handler handle() returned for it');
  });

  test('a Guard a live Endpoint attaches without a Handler throws, naming it', () => {
    const missing = { ...handlers, guards: {} };

    const serving = () => serve(contract, missing);

    expect(serving).toThrow('guards.apiKey has no Handler in the Handler map');
  });

  test('a Deprecated Endpoint without its deprecatedAt throws, since the map is stale', () => {
    const stale = { ...handlers, deprecatedAt: {} };

    const serving = () => serve(contract, stale);

    expect(serving).toThrow(
      'deprecatedAt.findOrder is missing or not an instant in the Handler map: run cf-loom generate',
    );
  });

  test.each([
    'Oct 17 2026',
    '2026-10-17',
    '2026-10-17T09:30:00.000Z',
    '2026-10-17T09:30:00+02:00',
    'yesterday',
  ])('a deprecatedAt that is not a stamp generate writes, %s, throws', (stamp) => {
    const loose = { ...handlers, deprecatedAt: { findOrder: stamp } };

    const serving = () => serve(contract, loose);

    expect(serving).toThrow('deprecatedAt.findOrder is missing or not an instant');
  });

  test('a map with no deprecatedAt at all throws the same, never a TypeError', () => {
    const { deprecatedAt: _stamps, ...withoutStamps } = handlers;

    const serving = () => serve(contract, withoutStamps as never);

    expect(serving).toThrow('deprecatedAt.findOrder is missing or not an instant');
  });

  test('a stamp for an Active Endpoint or a name the Contract lacks is ignored', () => {
    const extra = {
      ...handlers,
      deprecatedAt: { ...handlers.deprecatedAt, getOrder: 'junk', other: 'junk' },
    };

    const http = serve(contract, extra);

    expect(typeof http).toBe('function');
  });

  test('a Handler the map only inherits is no Handler', () => {
    const inherited = { ...handlers, endpoints: Object.create(handlers.endpoints) };

    const serving = () => serve(contract, inherited);

    expect(serving).toThrow('endpoints.getOrder has no Handler in the Handler map');
  });

  test('a GuardHandler written for another Guard throws, naming the Guard', () => {
    const swapped = { ...handlers, guards: { apiKey: handle(legacyKey, () => admit()) } };

    const serving = () => serve(contract, swapped as never);

    expect(serving).toThrow('guards.apiKey holds no Handler handle() returned for it');
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
    const withLookup = defineContract({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [lookup] })],
    });

    const serving = () =>
      serve(withLookup, {
        endpoints: { lookup: handle(lookup, () => success()) },
        guards: {},
        deprecatedAt: {},
      });

    expect(serving).toThrow('endpoints.lookup.input.query not-a-schema');
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
    const withSince = defineContract({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [since] })],
    });

    const serving = () =>
      serve(withSince, {
        endpoints: { since: handle(since, () => success()) },
        guards: {},
        deprecatedAt: {},
      });

    expect(serving).toThrow('endpoints.since.input.query.fields.at not allowed: z.date()');
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
    const withLookup = defineContract({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [lookup] })],
    });

    const serving = () =>
      serve(withLookup, {
        endpoints: { lookup: handle(lookup, () => success()) },
        guards: {},
        deprecatedAt: {},
      });

    expect(serving).toThrow('endpoints.lookup.input.query not-an-object-schema');
  });
});
