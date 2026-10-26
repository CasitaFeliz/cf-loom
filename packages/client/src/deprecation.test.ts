import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineService,
  type Endpoint,
  type ProvidedStandardRejections,
} from '@cf-loom/contract';
import { snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { client, type DeprecationNotice } from './index.ts';

const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  lifecycle: 'deprecated',
  deprecatedAt: '2026-10-17T09:30:00Z',
  success: { status: 200, body: z.object({ ids: z.array(z.string()) }) },
});

const listCarts = defineEndpoint({
  name: 'listCarts',
  method: 'GET',
  path: '/carts',
  visibility: 'public',
  description: 'Every cart',
  lifecycle: 'deprecated',
  deprecatedAt: '2026-10-17T09:30:00Z',
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
  const Endpoints extends Readonly<Record<string, Exportable>>,
  const Standards extends ProvidedStandardRejections,
>(endpoints: Endpoints, standardRejections: Standards, declared = Object.values(endpoints)) {
  const listed = declared as unknown as [Endpoint];
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: listed });
  const root = defineService({ name: 'orders-service', groups: [group] });
  const rootPackage = aRootPackage(root, { packageName: 'orders-service' });
  const validated = validateRoot(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const name = 'orders-service';
  const provided = providedEndpointsOf(name, endpoints, snapshot);
  return {
    name,
    endpoints: provided,
    events: {},
    standardRejections,
  };
}

const defaultStandards = providedStandardRejections();

const orders = contractPackageOf({ listOrders, listCarts, ping }, defaultStandards);

const ordersDependency = defineDependency({
  provider: orders,
  endpoints: [orders.endpoints.listOrders, orders.endpoints.listCarts, orders.endpoints.ping],
});

/** What a Deprecated Endpoint answers: its response with `Deprecation`, here a Rejection. */
async function deprecated(request: Request): Promise<Response> {
  if (request.url.endsWith('/ping')) {
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
    const orders = client(ordersDependency, {
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
    const first = client(ordersDependency, { baseUrl: 'http://orders.test', fetch: deprecated });
    const second = client(ordersDependency, { baseUrl: 'http://orders.test', fetch: deprecated });

    await first.listOrders();
    await first.listOrders();
    await second.listOrders();

    expect(warn.mock.calls).toEqual([
      ['orders-service: listOrders is Deprecated as of 2026-10-17T09:30:00Z'],
      ['orders-service: listOrders is Deprecated as of 2026-10-17T09:30:00Z'],
    ]);
  });

  test('a response carrying an instant still to come warns with the same wording', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scheduled = async () =>
      new Response(JSON.stringify({ ids: [] }), {
        headers: { deprecation: '@32472144000', 'content-type': 'application/json' },
      });
    const orders = client(ordersDependency, { baseUrl: 'http://orders.test', fetch: scheduled });

    await orders.listOrders();

    expect(warn.mock.calls).toEqual([
      ['orders-service: listOrders is Deprecated as of 2999-01-01T00:00:00Z'],
    ]);
  });

  test('an instant before 1970 is told, and one past the Date range is not', async () => {
    const notices: DeprecationNotice[] = [];
    const answering = (deprecation: string) =>
      client(ordersDependency, {
        baseUrl: 'http://orders.test',
        fetch: async () => Response.json({ ids: [] }, { headers: { deprecation } }),
        onDeprecation: (notice) => notices.push(notice),
      });

    const outcomes = [
      await answering('@-1').listOrders(),
      await answering('@99999999999999999').listOrders(),
      await answering('@-99999999999999').listOrders(),
    ];

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['success', 'success', 'success']);
    expect(notices.map((notice) => notice.deprecatedAt)).toEqual(['1969-12-31T23:59:59Z']);
  });

  test('what onDeprecation throws is caught and written to the console, and the Outcome returned', async () => {
    const error = new Error('a bug in the hook');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch: async () => {
        const headers = { deprecation: '@1792229400' };
        return Response.json({ ids: ['o-1'] }, { headers });
      },
      onDeprecation: () => {
        throw error;
      },
    });

    const outcome = await orders.listOrders();

    expect(outcome).toEqual({ kind: 'success', status: 200, body: { ids: ['o-1'] } });
    expect(logged).toHaveBeenCalledWith('orders-service: listOrders: onDeprecation threw', error);
  });

  test('is not told for an Active Endpoint', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const orders = client(ordersDependency, { baseUrl: 'http://orders.test', fetch: deprecated });

    await orders.ping();

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('fetch', () => {
  test('without the option, the global fetch is called, as it is at the call', async () => {
    const orders = client(ordersDependency, { baseUrl: 'http://orders.test' });
    const global = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', global);

    const outcome = await orders.ping();

    expect(outcome).toStrictEqual({ kind: 'success', status: 204 });
    expect(global).toHaveBeenCalledOnce();
  });
});
