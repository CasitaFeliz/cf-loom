import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineService,
  type ProvidedStandardRejections,
} from '@cf-loom/contract';
import { snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { handle, success } from '@cf-loom/handlers';
import { serve } from '@cf-loom/server';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { collected } from '../../contract/test/collected.ts';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { client, type Http } from './index.ts';

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
});

const provider = defineService({
  name: 'orders-service',
  groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] })],
});

/**
 * The Provider's Contract Package as `cf-loom package` writes it: its Endpoints, its resolved
 * Standard Rejections, and the Snapshot its declarations give, cut to what it exports.
 */
function contractPackageOf<
  const Endpoints extends Readonly<Record<string, Exportable>>,
  const Standards extends ProvidedStandardRejections,
>(endpoints: Endpoints, standardRejections: Standards) {
  const rootPackage = aRootPackage(provider, { packageName: 'orders-service' });
  const validated = validateRoot(provider, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const name = 'orders-service';
  const provided = providedEndpointsOf({ name, standardRejections }, endpoints, snapshot);
  return { name, endpoints: provided, events: {}, standardRejections };
}

const orders = contractPackageOf({ getOrder }, providedStandardRejections());

const ordersDependency = defineDependency({ endpoints: [orders.endpoints.getOrder] });

const input = { params: { orderId: 'o-1' } };

function ordersOver(fetch: Http) {
  return client(ordersDependency, { baseUrl: 'http://orders.test', fetch });
}

/** A promise that rejects with `signal`'s reason once it aborts, keeping nothing but the signal. */
function abortOf(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  });
}

/** What `call` has settled to within a second, or `'pending'`. */
async function settledOf(call: Promise<unknown>): Promise<unknown> {
  const pending = new Promise((resolve) => setTimeout(() => resolve('pending'), 1000));
  return await Promise.race([call, pending]);
}

/** Weak references to the Requests a `fetch` received, and that `fetch`, answering `answer`. */
function recording(answer: () => Promise<Response>) {
  const requests: WeakRef<Request>[] = [];
  const fetch = (request: Request) => {
    requests.push(new WeakRef(request));
    return answer();
  };
  return { requests, fetch };
}

function heldOf(requests: readonly WeakRef<Request>[]): number {
  return requests.filter((request) => request.deref() !== undefined).length;
}

function found(): Promise<Response> {
  const headers = { 'content-type': 'application/json' };
  return Promise.resolve(new Response('{"id":"o-1"}', { status: 200, headers }));
}

describe('a Caller’s signal after a garbage collection', () => {
  test.each([
    { given: 'its own controller’s', signalOf: (source: AbortSignal) => source },
    {
      given: 'a composite of AbortSignal.any',
      signalOf: (source: AbortSignal) => AbortSignal.any([source]),
    },
  ])(
    'aborting $given signal still settles a call whose fetch waits only on its Request’s signal, as the aborted Fault',
    async ({ signalOf }) => {
      const controller = new AbortController();
      const { promise: fetchStarted, resolve: started } = Promise.withResolvers<void>();
      const orders = ordersOver((request) => {
        started();
        return abortOf(request.signal);
      });

      const call = orders.getOrder(input, { signal: signalOf(controller.signal) });
      await fetchStarted;
      await collected();
      controller.abort();

      expect(await settledOf(call)).toMatchObject({ kind: 'fault', source: 'aborted' });
    },
  );

  test('a Caller’s abort reaches the Handler of a Provider served in the same process', async () => {
    const events: string[] = [];
    const { promise: handlerStarted, resolve: started } = Promise.withResolvers<void>();
    const { promise: sawAbort, resolve: saw } = Promise.withResolvers<void>();
    const waiting = handle(getOrder, async ({ params }, { request: { signal } }) => {
      started();
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
      events.push('saw abort');
      saw();
      return success(getOrder, { id: params.orderId });
    });
    const orders = ordersOver(
      serve(provider, { endpoints: { getOrder: waiting }, guards: {} }, {}),
    );
    const controller = new AbortController();

    void orders.getOrder(input, { signal: controller.signal });
    await handlerStarted;
    await collected();
    controller.abort();
    await settledOf(sawAbort);

    expect(events).toEqual(['saw abort']);
  });

  test.each([1, 200])(
    '%i settled calls leave their Requests unheld by a signal that outlives them',
    async (count) => {
      const controller = new AbortController();
      const { requests, fetch } = recording(found);
      const orders = ordersOver(fetch);

      for (let call = 0; call < count; call++) {
        await orders.getOrder(input, { signal: controller.signal });
      }
      await collected();

      expect(requests).toHaveLength(count);
      expect(heldOf(requests)).toBe(0);
      expect(controller.signal.aborted).toBe(false);
    },
  );

  test.each([
    {
      fetching: 'throws at once',
      answer: () => {
        throw new TypeError('fetch failed');
      },
    },
    { fetching: 'rejects', answer: () => Promise.reject(new TypeError('fetch failed')) },
  ])('a fetch that $fetching leaves its Request unheld', async ({ answer }) => {
    const controller = new AbortController();
    const { requests, fetch } = recording(answer);
    const orders = ordersOver(fetch);

    await orders.getOrder(input, { signal: controller.signal });
    await collected();

    expect(heldOf(requests)).toBe(0);
    expect(controller.signal.aborted).toBe(false);
  });
});
