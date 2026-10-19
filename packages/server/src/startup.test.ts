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
      'deprecatedAt.findOrder is missing from the Handler map: run cf-loom generate',
    );
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
