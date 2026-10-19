import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  type Endpoint,
  type StandardRejections,
} from '@casitafeliz/loom-contract';
import { snapshotOf, validateContract } from '@casitafeliz/loom-contract/internal';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { client, type DeprecationNotice } from './index.ts';

const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  lifecycle: 'deprecated',
  success: { status: 200, body: z.object({ ids: z.array(z.string()) }) },
});

const listCarts = defineEndpoint({
  name: 'listCarts',
  method: 'GET',
  path: '/carts',
  visibility: 'public',
  description: 'Every cart',
  lifecycle: 'deprecated',
  success: { status: 200, body: z.object({ ids: z.array(z.string()) }) },
});

const ping = defineEndpoint({
  name: 'ping',
  method: 'GET',
  path: '/ping',
  visibility: 'public',
  description: 'Whether the Service is up',
  success: { status: 204 },
});

/**
 * The Provider's Contract Package as `cf-loom package` writes it: its Endpoints, its resolved
 * Standard Rejections, and the Snapshot its declarations give, cut to what it exports.
 */
function contractPackageOf<
  const Endpoints extends ContractPackage['endpoints'],
  const Standards extends StandardRejections,
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
  const { format, defs, guards, codes } = snapshot;
  const exportedSnapshot = { format, defs, endpoints: snapshot.endpoints, guards, codes };
  const name = 'orders-service';
  return { name, version: '1.0.0', endpoints, events: {}, standardRejections, exportedSnapshot };
}

const defaultStandards = {
  invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
  notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
} as const;

const orders = contractPackageOf({ listOrders, listCarts, ping }, defaultStandards);

const ordersDeps = defineDependencies(orders, { endpoints: [listOrders, listCarts, ping] });

/** What a Deprecated Endpoint answers: its response with `Deprecation`, here a Rejection. */
async function deprecated(url: string): Promise<Response> {
  if (url.endsWith('/ping')) {
    return new Response(null, { status: 204 });
  }
  const headers = { deprecation: '@1792229400' };
  const rejection = { code: 'GONE_SOON', message: 'Soon' };
  return Response.json({ rejection }, { status: 409, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the Deprecation warning', () => {
  test('is told once per method of a client, naming the Provider, the Endpoint and when', async () => {
    const notices: DeprecationNotice[] = [];
    const orders = client(ordersDeps, {
      baseUrl: 'http://orders.test',
      fetch: deprecated,
      onDeprecation: (notice) => notices.push(notice),
    });

    await orders.listOrders();
    await orders.listOrders();
    await orders.listCarts();
    await orders.ping();

    expect(notices).toEqual([
      { provider: 'orders-service', endpoint: 'listOrders', deprecatedAt: '2026-10-17T09:30:00Z' },
      { provider: 'orders-service', endpoint: 'listCarts', deprecatedAt: '2026-10-17T09:30:00Z' },
    ]);
  });

  test('goes to the console without onDeprecation, once per client', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = client(ordersDeps, { baseUrl: 'http://orders.test', fetch: deprecated });
    const second = client(ordersDeps, { baseUrl: 'http://orders.test', fetch: deprecated });

    await first.listOrders();
    await first.listOrders();
    await second.listOrders();

    expect(warn.mock.calls).toEqual([
      ['orders-service: listOrders is Deprecated since 2026-10-17T09:30:00Z'],
      ['orders-service: listOrders is Deprecated since 2026-10-17T09:30:00Z'],
    ]);
  });

  test('is not told for an Active Endpoint', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const orders = client(ordersDeps, { baseUrl: 'http://orders.test', fetch: deprecated });

    await orders.ping();

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('fetch', () => {
  test('without the option, the global fetch is called, as it is at the call', async () => {
    const orders = client(ordersDeps, { baseUrl: 'http://orders.test' });
    const global = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', global);

    const outcome = await orders.ping();

    expect(outcome).toEqual({ kind: 'success', value: undefined, headers: {} });
    expect(global).toHaveBeenCalledOnce();
  });
});
