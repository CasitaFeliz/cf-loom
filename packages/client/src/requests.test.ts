import {
  type ContractPackage,
  defineContract,
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineGuard,
  type Endpoint,
  type ExportedSnapshot,
  openEnumReader,
  type ProvidedStandardRejections,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateContract } from '@cf-loom/contract/internal';
import { handle, success } from '@cf-loom/handlers';
import { serve } from '@cf-loom/server';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { client } from './index.ts';

const searchOrders = defineEndpoint({
  name: 'searchOrders',
  method: 'GET',
  path: '/shops/:shopId/orders',
  visibility: 'public',
  description: 'Orders of a shop',
  input: {
    params: z.object({ shopId: z.string() }),
    query: z.object({
      ids: z.array(z.string()),
      tags: z.array(z.string()).optional(),
      minimum: z.number().optional(),
      open: z.boolean().optional(),
    }),
    headers: z.object({ 'x-trace': z.string().optional() }),
  },
  success: { status: 200, body: z.object({ count: z.int() }) },
});

const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/shops/:shopId/orders',
  visibility: 'public',
  description: 'A new order',
  input: {
    params: z.object({ shopId: z.string() }),
    body: z.object({ quantity: z.int().min(1), note: z.string().optional() }),
  },
  success: { status: 201, body: z.object({ quantity: z.int() }) },
});

const priceOrder = defineEndpoint({
  name: 'priceOrder',
  method: 'GET',
  path: '/prices/:amount',
  visibility: 'public',
  description: 'Echoes an amount',
  input: {
    params: z.object({ amount: z.number() }),
    query: z.object({ ratio: z.number(), exact: z.boolean() }),
    headers: z.object({ 'x-scale': z.number() }),
  },
  success: {
    status: 200,
    body: z.object({
      amount: z.number(),
      ratio: z.number(),
      scale: z.number(),
      exact: z.boolean(),
    }),
  },
});

/**
 * The Provider's Contract Package as `cf-loom package` writes it: its Endpoints, its resolved
 * Standard Rejections, and the Snapshot its declarations give, cut to what it exports.
 */
function contractPackageOf<
  const Endpoints extends ContractPackage['endpoints'],
  const Standards extends ProvidedStandardRejections,
>(endpoints: Endpoints, standardRejections: Standards, declared = Object.values(endpoints)) {
  const listed = declared as unknown as [Endpoint];
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: listed });
  const root = defineContract({ name: 'orders-service', groups: [group] });
  const rootPackage = {
    packageName: 'orders-service',
    originOf: () => undefined,
    exportsOf: () => [],
  };
  const validated = validateContract(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const context = { generator: 'test', packages: [], committed: undefined, now: 0 };
  const snapshot = snapshotOf(validated, context);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const exportedSnapshot = exportedSnapshotOf(snapshot);
  const name = 'orders-service';
  return { name, version: '1.0.0', endpoints, events: {}, standardRejections, exportedSnapshot };
}

const defaultStandards = providedStandardRejections();

const orders = contractPackageOf({ searchOrders, createOrder, priceOrder }, defaultStandards);

const ordersDependency = defineDependency({
  provider: orders,
  endpoints: [searchOrders, createOrder, priceOrder],
});

/** The Provider's Contract Package as another cf-loom wrote it: a `format` of its own and no entry a listed Endpoint could find. */
function inFormat(contractPackage: typeof orders, format: unknown): typeof orders {
  const exportedSnapshot = { ...contractPackage.exportedSnapshot, format, endpoints: {} };
  return { ...contractPackage, exportedSnapshot: exportedSnapshot as ExportedSnapshot };
}

/** A client whose `fetch` records each request and answers `response`. */
function recording(response: () => Response, baseUrl: string | URL = 'http://orders.test') {
  const sent: Request[] = [];
  const orders = client(ordersDependency, {
    baseUrl,
    fetch: async (request) => {
      sent.push(request);
      return response();
    },
  });
  return { orders, sent };
}

const counted = () => Response.json({ count: 1 });

describe('what a call sends', () => {
  test('the Request fetch receives never follows a redirect', async () => {
    const { orders, sent } = recording(counted);

    await orders.searchOrders({ params: { shopId: 's-1' }, query: { ids: ['1'] } });

    expect(sent[0]?.redirect).toBe('manual');
  });

  test('each path param is percent-encoded as one segment', async () => {
    const { orders, sent } = recording(counted);

    await orders.searchOrders({ params: { shopId: 'a/b c?' }, query: { ids: ['1'] } });

    expect(new URL(sent[0]?.url ?? '').pathname).toBe('/shops/a%2Fb%20c%3F/orders');
  });

  test('a list query param is its key repeated, and a list with no items sends no key', async () => {
    const { orders, sent } = recording(counted);

    await orders.searchOrders({ params: { shopId: 's' }, query: { ids: ['1', '2'], tags: [] } });

    expect(new URL(sent[0]?.url ?? '').search).toBe('?ids=1&ids=2');
  });

  test('numbers and booleans travel as text, a number in plain decimal', async () => {
    const { orders, sent } = recording(counted);

    await orders.searchOrders({
      params: { shopId: 's' },
      query: { ids: ['1'], minimum: 1e21, open: false },
      headers: { 'x-trace': 't' },
    });

    const url = new URL(sent[0]?.url ?? '');
    expect(url.searchParams.get('minimum')).toBe('1000000000000000000000');
    expect(url.searchParams.get('open')).toBe('false');
    expect(sent[0]?.headers.get('x-trace')).toBe('t');
  });

  test('the body is the parsed value, unknown keys stripped, sent as JSON', async () => {
    const { orders, sent } = recording(() => Response.json({ quantity: 2 }, { status: 201 }));

    await orders.createOrder({
      params: { shopId: 's' },
      body: { quantity: 2, unknownKey: 'dropped' } as { quantity: number },
    });

    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await sent[0]?.json()).toEqual({ quantity: 2 });
  });

  test('the baseUrl’s path is kept as a prefix, one trailing slash removed', async () => {
    const withSlash = recording(counted, 'http://gateway.test/orders-api/');
    const asUrl = recording(counted, new URL('http://gateway.test/orders-api'));
    const input = { params: { shopId: 's' }, query: { ids: ['1'] } };

    await withSlash.orders.searchOrders(input);
    await asUrl.orders.searchOrders(input);

    expect(withSlash.sent[0]?.url).toBe('http://gateway.test/orders-api/shops/s/orders?ids=1');
    expect(asUrl.sent[0]?.url).toBe('http://gateway.test/orders-api/shops/s/orders?ids=1');
  });

  test('a baseUrl with a query or a fragment is a bug, thrown when the client is created', () => {
    const withQuery = () => client(ordersDependency, { baseUrl: 'http://orders.test/?key=1' });
    const withFragment = () => client(ordersDependency, { baseUrl: 'http://orders.test/#top' });

    expect(withQuery).toThrow(/query or a fragment/);
    expect(withFragment).toThrow(/query or a fragment/);
  });

  test('a baseUrl with a username or a password is a bug, thrown when the client is created', () => {
    const withUsername = () => client(ordersDependency, { baseUrl: 'http://ann@orders.test/' });
    const withPassword = () => client(ordersDependency, { baseUrl: 'http://:secret@orders.test/' });

    expect(withUsername).toThrow(/a username or a password/);
    expect(withPassword).toThrow(/a username or a password/);
  });

  test('a baseUrl ending in an empty query or fragment is refused too', () => {
    const emptyQuery = () => client(ordersDependency, { baseUrl: 'http://orders.test/?' });
    const emptyFragment = () => client(ordersDependency, { baseUrl: 'http://orders.test/#' });

    expect(emptyQuery).toThrow(/query or a fragment/);
    expect(emptyFragment).toThrow(/query or a fragment/);
  });

  test('an optional query param passed as undefined sends no key', async () => {
    const { orders, sent } = recording(counted);

    await orders.searchOrders({
      params: { shopId: 's' },
      query: { ids: ['1'], minimum: undefined },
    });

    expect(new URL(sent[0]?.url ?? '').search).toBe('?ids=1');
  });

  test('numbers like 1e21 and 1.5e-7 reach serve as the same numbers', async () => {
    const handlers = {
      endpoints: {
        priceOrder: handle(priceOrder, ({ params, query, headers }) =>
          success({
            amount: params.amount,
            ratio: query.ratio,
            scale: headers['x-scale'],
            exact: query.exact,
          }),
        ),
      },
      guards: {},
      deprecatedAt: {},
    };
    const provider = defineContract({
      name: 'orders-service',
      groups: [defineGroup({ name: 'prices', description: 'Prices', endpoints: [priceOrder] })],
    });
    const http = serve(provider, handlers);
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch: http,
    });

    const outcome = await orders.priceOrder({
      params: { amount: 1e21 },
      query: { ratio: 1.5e-7, exact: true },
      headers: { 'x-scale': -2.5e-10 },
    });

    expect(outcome).toEqual({
      kind: 'success',
      status: 200,
      body: { amount: 1e21, ratio: 1.5e-7, scale: -2.5e-10, exact: true },
    });
  });
});

describe('Input that cannot be sent', () => {
  /** A client whose `fetch` must never be called. */
  function unsent() {
    let calls = 0;
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch: async () => {
        calls += 1;
        return counted();
      },
    });
    return { orders, calls: () => calls };
  }

  test('a broken constraint is the Provider’s invalid-input Rejection, marked source client, and nothing is sent', async () => {
    const { orders, calls } = unsent();

    const outcome = await orders.createOrder({ params: { shopId: 's' }, body: { quantity: 0 } });

    expect(outcome).toEqual({
      kind: 'rejection',
      source: 'client',
      code: 'INVALID_INPUT',
      status: 400,
      message: 'Invalid input',
      body: {
        issues: [
          { in: 'body', path: ['quantity'], code: 'too_small', message: expect.any(String) },
        ],
      },
    });
    expect(calls()).toBe(0);
  });

  test('a header with a CR or LF cannot travel as field text', async () => {
    const { orders, calls } = unsent();

    const outcome = await orders.searchOrders({
      params: { shopId: 's' },
      query: { ids: ['1'] },
      headers: { 'x-trace': 'a\r\nx-injected: 1' },
    });

    expect(outcome).toMatchObject({
      kind: 'rejection',
      code: 'INVALID_INPUT',
      body: { issues: [{ in: 'headers', path: ['x-trace'], code: 'invalid_format' }] },
    });
    expect(calls()).toBe(0);
  });

  test.each(['..', '.', '', 'a\uD800'])(
    'a path param of %j cannot travel as a segment',
    async (shopId) => {
      const { orders, calls } = unsent();

      const outcome = await orders.searchOrders({ params: { shopId }, query: { ids: ['1'] } });

      expect(outcome).toMatchObject({
        kind: 'rejection',
        code: 'INVALID_INPUT',
        body: { issues: [{ in: 'params', path: ['shopId'], code: 'invalid_format' }] },
      });
      expect(calls()).toBe(0);
    },
  );

  test('a required list with no items is refused, as serve reads no key as absent', async () => {
    const { orders, calls } = unsent();

    const outcome = await orders.searchOrders({ params: { shopId: 's' }, query: { ids: [] } });

    expect(outcome).toMatchObject({
      kind: 'rejection',
      code: 'INVALID_INPUT',
      body: { issues: [{ in: 'query', path: ['ids'], code: 'required' }] },
    });
    expect(calls()).toBe(0);
  });

  test('an issue code the Provider’s Reader does not declare is its Unknown case, as the Caller’s cf-loom may know more', async () => {
    const olderReader = z.object({
      issues: z.array(
        z.object({
          in: openEnumReader(['body', 'headers', 'params', 'query']),
          path: z.array(z.union([z.string(), z.number()])),
          code: openEnumReader(['invalid_type', 'too_small']),
          message: z.string(),
        }),
      ),
    });
    const older = contractPackageOf(
      { searchOrders },
      {
        ...defaultStandards,
        invalidInput: { ...defaultStandards.invalidInput, body: olderReader },
      },
    );
    const olderOrders = client(defineDependency({ provider: older, endpoints: [searchOrders] }), {
      baseUrl: 'http://orders.test',
      fetch: async () => counted(),
    });

    const outcome = await olderOrders.searchOrders({
      params: { shopId: 's' },
      query: { ids: [] },
    });

    expect(outcome).toMatchObject({
      kind: 'rejection',
      code: 'INVALID_INPUT',
      body: { issues: [{ in: 'query', path: ['ids'], code: { unknown: 'required' } }] },
    });
  });

  test('a query value or header with a lone surrogate cannot travel', async () => {
    const { orders, calls } = unsent();

    const outcomes = [
      await orders.searchOrders({ params: { shopId: 's' }, query: { ids: ['a\uDC00'] } }),
      await orders.searchOrders({
        params: { shopId: 's' },
        query: { ids: ['1'] },
        headers: { 'x-trace': 'a\uD800' },
      }),
    ];

    expect(outcomes).toMatchObject([
      { body: { issues: [{ in: 'query', path: ['ids', 0], code: 'invalid_format' }] } },
      { body: { issues: [{ in: 'headers', path: ['x-trace'], code: 'invalid_format' }] } },
    ]);
    expect(calls()).toBe(0);
  });

  test('a body left out answers that the content type is not application/json, as serve answers the request sent without one, and alone', async () => {
    const { orders, calls } = unsent();
    const leftOut = { params: {} } as Parameters<typeof orders.createOrder>[0];

    const outcome = await orders.createOrder(leftOut);

    expect(outcome).toMatchObject({
      body: {
        issues: [
          {
            in: 'body',
            path: [],
            code: 'malformed',
            message: 'The content type is not application/json',
          },
        ],
      },
    });
    expect(outcome.kind === 'rejection' && 'body' in outcome && outcome.body).toMatchObject({
      issues: { length: 1 },
    });
    expect(calls()).toBe(0);
  });

  test('a param and a query text that cannot travel are answered with a header that cannot', async () => {
    const { orders } = unsent();

    const outcome = await orders.searchOrders({
      params: { shopId: '..' },
      query: { ids: ['a\uDC00'] },
      headers: { 'x-trace': 'a\nb' },
    });

    expect(outcome).toMatchObject({
      body: {
        issues: [
          { in: 'params', path: ['shopId'] },
          { in: 'query', path: ['ids', 0] },
          { in: 'headers', path: ['x-trace'] },
        ],
      },
    });
  });
});

describe('a Guard’s demands, checked before the Input, as serve checks them', () => {
  const apiKey = defineGuard({
    name: 'apiKey',
    description: 'A key per Caller',
    demands: { headers: z.object({ 'x-api-key': z.string().min(2) }) },
  });
  const makeOrder = defineEndpoint({
    name: 'makeOrder',
    method: 'POST',
    path: '/make',
    visibility: 'public',
    description: 'A new order',
    guards: [apiKey],
    input: {
      headers: z.object({ 'x-api-key': z.string().min(2) }),
      body: z.object({ quantity: z.int().max(3) }),
    },
    success: { status: 204 },
  });
  const making = contractPackageOf({ makeOrder }, defaultStandards);
  const makingDependency = defineDependency({ provider: making, endpoints: [makeOrder] });

  test('a demand that fails gives only its Issues, though the body fails too', async () => {
    const makers = client(makingDependency, {
      baseUrl: 'http://orders.test',
      fetch: async () => counted(),
    });

    const outcome = await makers.makeOrder({
      headers: { 'x-api-key': 'a' },
      body: { quantity: 9 },
    });

    expect(outcome).toMatchObject({
      code: 'INVALID_INPUT',
      body: { issues: [{ in: 'headers', path: ['x-api-key'], code: 'too_small' }] },
    });
    expect(outcome.kind === 'rejection' && 'body' in outcome && outcome.body).toMatchObject({
      issues: { length: 1 },
    });
  });
});

describe('a number literal in exponent form, end to end against serve', () => {
  const echoLarge = defineEndpoint({
    name: 'echoLarge',
    method: 'GET',
    path: '/large/:size',
    visibility: 'public',
    description: 'Echoes a large literal',
    input: { params: z.object({ size: z.literal(1e21) }) },
    success: { status: 204, headers: z.object({ 'x-small': z.literal(1.5e-7) }) },
  });
  const echoing = contractPackageOf({ echoLarge }, defaultStandards);
  const echoingDependency = defineDependency({ provider: echoing, endpoints: [echoLarge] });

  test('travels as plain decimal both ways and reads back as its literal', async () => {
    const handlers = {
      endpoints: {
        echoLarge: handle(echoLarge, () => success({ headers: { 'x-small': 1.5e-7 } })),
      },
      guards: {},
      deprecatedAt: {},
    };
    const provider = defineContract({
      name: 'orders-service',
      groups: [defineGroup({ name: 'large', description: 'Large', endpoints: [echoLarge] })],
    });
    const http = serve(provider, handlers);
    const echoes = client(echoingDependency, {
      baseUrl: 'http://orders.test',
      fetch: http,
    });

    const outcome = await echoes.echoLarge({ params: { size: 1e21 } });

    expect(outcome).toEqual({ kind: 'success', status: 204, headers: { 'x-small': 1.5e-7 } });
  });
});

describe('several Guards, checked in Attachment order', () => {
  const region = defineGuard({
    name: 'region',
    description: 'A region and its tags',
    demands: {
      headers: z.object({ 'x-region': z.enum(['eu', 'us']) }),
      query: z.object({ tags: z.array(z.string()).min(1).optional(), zone: z.string().min(2) }),
    },
  });
  const tenant = defineGuard({
    name: 'tenant',
    description: 'A tenant',
    demands: { headers: z.object({ 'x-tenant': z.string().min(3) }) },
  });
  const listShops = defineEndpoint({
    name: 'listShops',
    method: 'GET',
    path: '/shops',
    visibility: 'public',
    description: 'Every shop',
    guards: [region, tenant],
    input: {
      query: z.object({
        tags: z.array(z.string()).min(1).optional(),
        zone: z.string().min(2),
        page: z.int(),
      }),
      headers: z.object({ 'x-region': z.enum(['eu', 'us']), 'x-tenant': z.string().min(3) }),
    },
    success: { status: 204 },
  });
  const shops = contractPackageOf({ listShops }, defaultStandards);
  const shopsDependency = defineDependency({ provider: shops, endpoints: [listShops] });
  const shopsClient = () =>
    client(shopsDependency, {
      baseUrl: 'http://shops.test',
      fetch: async () => new Response(null, { status: 204 }),
    });
  const valid = {
    query: { zone: 'eu-1', page: 1 },
    headers: { 'x-region': 'eu', 'x-tenant': 'acme' },
  } as const;

  test('two Guards that both fail answer with the first one’s Issues', async () => {
    const outcome = await shopsClient().listShops({
      ...valid,
      headers: { 'x-region': 'fr' as 'eu', 'x-tenant': 'a' },
    });

    expect(outcome).toMatchObject({
      body: { issues: [{ in: 'headers', path: ['x-region'], code: 'invalid_value' }] },
    });
    expect(outcome.kind === 'rejection' && 'body' in outcome && outcome.body).toMatchObject({
      issues: { length: 1 },
    });
  });

  test('a demand in a Guard’s query failing beside the Input answers alone', async () => {
    const outcome = await shopsClient().listShops({
      ...valid,
      query: { zone: 'e', page: 'x' as unknown as number },
    });

    expect(outcome).toMatchObject({
      body: { issues: [{ in: 'query', path: ['zone'], code: 'too_small' }] },
    });
    expect(outcome.kind === 'rejection' && 'body' in outcome && outcome.body).toMatchObject({
      issues: { length: 1 },
    });
  });

  test('an empty list in a Guard’s query is dropped before its demands are parsed', async () => {
    const outcome = await shopsClient().listShops({
      ...valid,
      query: { ...valid.query, tags: [] },
    });

    expect(outcome).toStrictEqual({ kind: 'success', status: 204 });
  });
});

describe('a Provider’s exported Snapshot, read when the client is created', () => {
  test('a Contract Package in a newer format is refused', () => {
    const newer = defineDependency({ provider: inFormat(orders, 2), endpoints: [searchOrders] });

    const create = () => client(newer, { baseUrl: 'http://orders.test' });

    expect(create).toThrow(
      "orders-service's exported Snapshot is in format 2, newer than this cf-loom reads: upgrade the @cf-loom packages",
    );
  });

  test('a Contract Package in a newer format is refused even when no Endpoint is listed', () => {
    const newer = defineDependency({ provider: inFormat(orders, 2), endpoints: [] });

    const create = () => client(newer, { baseUrl: 'http://orders.test' });

    expect(create).toThrow('is in format 2, newer than this cf-loom reads');
  });

  test('a Contract Package whose format is no whole number from 1 is refused as malformed', () => {
    const damaged = defineDependency({
      provider: inFormat(orders, '1'),
      endpoints: [searchOrders],
    });

    const create = () => client(damaged, { baseUrl: 'http://orders.test' });

    expect(create).toThrow(
      "orders-service's exported Snapshot is malformed: format is not a whole number from 1",
    );
  });
});
