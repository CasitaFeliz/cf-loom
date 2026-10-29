import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineService,
  type Endpoint,
  notFound,
  type ProvidedStandardRejections,
} from '@cf-loom/contract';
import { snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { admit, handle, success, type WithResources } from '@cf-loom/handlers';
import { serve } from '@cf-loom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { type Client, client } from './index.ts';

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'public',
  description: 'One payment by id',
  input: {
    params: z.object({ paymentId: z.uuid() }),
    headers: z.object({ 'x-api-key': z.string() }),
  },
  success: { status: 200, body: z.object({ amount: z.int() }) },
  rejections: [notFound],
});

const idempotencyKey = defineGuard({
  name: 'idempotencyKey',
  description: 'The key of one attempt to do a thing, sent again with each retry of it',
  demands: { headers: z.object({ 'idempotency-key': z.string().min(1) }) },
  context: z.object({ key: z.string() }),
});

const newPayment = z.object({ amount: z.int() });

const createPaymentDeclaration = {
  name: 'createPayment',
  method: 'POST',
  path: '/payments',
  visibility: 'public',
  description: 'A new payment',
  guards: [idempotencyKey],
  success: { status: 201, body: z.object({ id: z.string(), amount: z.int() }) },
} as const;

/** The Provider's declaration: the Guard alone demands the key. */
const createPayment = defineEndpoint({
  ...createPaymentDeclaration,
  input: { body: newPayment },
});

/** The Endpoint as the Contract Package exports it, with the Guard's demands in its Input. */
const createPaymentExported = defineEndpoint({
  ...createPaymentDeclaration,
  input: { headers: z.object({ 'idempotency-key': z.string().min(1) }), body: newPayment },
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
  const group = defineGroup({ name: 'payments', description: 'Payments', endpoints: listed });
  const root = defineService({ name: 'payments-service', groups: [group] });
  const rootPackage = aRootPackage(root, { packageName: 'payments-service' });
  const validated = validateRoot(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const name = 'payments-service';
  const provided = providedEndpointsOf({ name, standardRejections }, endpoints, snapshot);
  return {
    name,
    endpoints: provided,
    events: {},
    standardRejections,
  };
}

const payments = contractPackageOf(
  { getPayment, createPayment: createPaymentExported },
  providedStandardRejections(),
  [getPayment, createPayment],
);

const paymentsDependency = defineDependency({
  endpoints: [payments.endpoints.getPayment, payments.endpoints.createPayment],
});

const paymentId = '6f1c2a3e-8a4b-4c1d-9e2f-0a1b2c3d4e5f';
const settings = { paymentsKey: 'k-1' };

/** The README's example, against a `fetch` that answers what the test gives. */
async function readmeExample(answer: () => Response) {
  const baseUrl = 'https://payments.test';
  const fetch = async () => answer();

  const payments = client(paymentsDependency, {
    baseUrl,
    headers: { 'x-api-key': settings.paymentsKey }, // a string
    fetch,
  });
  const outcome = await payments.getPayment({ params: { paymentId } });

  switch (outcome.kind) {
    case 'success':
      return outcome.body.amount;
    case 'rejection':
      if (outcome.code === 'NOT_FOUND') return null; // getPayment lists notFound
      throw new Error(outcome.message);
    case 'unknown-rejection':
      throw new Error(`${outcome.code}: ${outcome.message}`);
    case 'fault':
      if (outcome.committed === 'no' && outcome.retryable) return null; // a Caller retries here, as Retrying shows
      throw new Error(`payments-service failed: ${outcome.source}`);
  }
}

describe('the README', () => {
  test('Consuming a Contract runs, through a Success, a known Rejection and a Fault', async () => {
    const results = [
      await readmeExample(() => Response.json({ amount: 120 })),
      await readmeExample(() =>
        Response.json({ rejection: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 }),
      ),
      await readmeExample(() => new Response(null, { status: 429 })),
    ];

    expect(results).toEqual([120, null, null]);
  });

  test('under the README’s retry rule a cancelled call is never retried', async () => {
    const payments = client(paymentsDependency, {
      baseUrl: 'https://payments.test',
      headers: { 'x-api-key': settings.paymentsKey },
      fetch: async () => Response.json({ amount: 120 }),
    });
    const cancelled = AbortSignal.abort();
    let attempts = 0;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      attempts += 1;
      const outcome = await payments.getPayment({ params: { paymentId } }, { signal: cancelled });
      if (outcome.kind !== 'fault' || outcome.committed !== 'no' || !outcome.retryable) {
        break;
      }
    }

    expect(attempts).toBe(1);
  });

  test('a fetch wrapper building another Request sends the call with a browser’s credentials', async () => {
    const sent: Request[] = [];
    const answering = async (request: Request) => {
      sent.push(request);
      return Response.json({ amount: 120 });
    };
    const credentialed: Client<typeof paymentsDependency, 'x-api-key'> = client(
      paymentsDependency,
      {
        baseUrl: 'https://payments.test',
        headers: { 'x-api-key': 'k' },
        fetch: (request) => answering(new Request(request, { credentials: 'include' })),
      },
    );

    await credentialed.getPayment({ params: { paymentId } });

    expect(sent[0]?.credentials).toBe('include');
    expect(sent[0]?.headers.get('x-api-key')).toBe('k');
  });

  test('a bare TypeError, as a browser’s fetch throws it, is connection-failed and not retryable until inferFault relaxes it', async () => {
    const blocked = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    };
    const options = { baseUrl: 'https://payments.test', headers: { 'x-api-key': 'k' } };
    const asIs = client(paymentsDependency, { ...options, fetch: blocked });
    const relaxed = client(paymentsDependency, {
      ...options,
      fetch: blocked,
      inferFault: (happened) =>
        happened.kind === 'connection-failed'
          ? { committed: 'unknown', retryable: true }
          : undefined,
    });

    const outcomes = [
      await asIs.getPayment({ params: { paymentId } }),
      await relaxed.getPayment({ params: { paymentId } }),
    ];

    expect(outcomes).toMatchObject([
      { kind: 'fault', source: 'connection-failed', committed: 'unknown', retryable: false },
      { kind: 'fault', source: 'connection-failed', committed: 'unknown', retryable: true },
    ]);
  });
});

type Payment = { readonly id: string; readonly amount: number };

type Resources = {
  readonly payments: {
    byKey(key: string): Promise<Payment | undefined>;
    create(key: string, amount: number): Promise<Payment>;
  };
};

type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;

const idempotencyKeyHandler = handle(idempotencyKey, ({ headers }) =>
  admit(idempotencyKey, { key: headers['idempotency-key'] }),
);

const createPaymentHandler = handle(
  createPayment,
  async ({ body }, { context }, { resources: { payments } }: Needs<'payments'>) => {
    const { key } = context.idempotencyKey;
    const done = await payments.byKey(key);
    if (done) return success(createPayment, done);
    const payment = await payments.create(key, body.amount);
    return success(createPayment, payment);
  },
);

/** The Provider's Release, served in memory, with a table of the payments it created by key. */
function providerOf() {
  const created = new Map<string, Payment>();
  const service = defineService({
    name: 'payments-service',
    groups: [
      defineGroup({ name: 'payments', description: 'Payments', endpoints: [createPayment] }),
    ],
  });
  const handlers = {
    endpoints: { createPayment: createPaymentHandler },
    guards: { idempotencyKey: idempotencyKeyHandler },
  };
  const resources: Resources = {
    payments: {
      byKey: async (key) => created.get(key),
      create: async (key, amount) => {
        const payment = { id: `p-${created.size + 1}`, amount };
        created.set(key, payment);
        return payment;
      },
    },
  };
  return { created, http: serve(service, handlers, { resources }) };
}

/** The README's Caller that retries with one key, against a `fetch` that answers what the test gives. */
function readmePay(fetch: (request: Request) => Promise<Response>) {
  const payments = client(paymentsDependency, { baseUrl: 'https://payments.test', fetch });

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** `Retry-After` as received, whole seconds or an HTTP date, in milliseconds; a second without a usable one. */
  function delayOf(retryAfter: string | undefined): number {
    if (retryAfter === undefined) return 1000;
    if (/^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
    const until = Date.parse(retryAfter) - Date.now();
    return Number.isNaN(until) ? 1000 : Math.max(0, until);
  }

  async function pay(amount: number) {
    const key = crypto.randomUUID(); // the same on every attempt at this payment
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await payments.createPayment({
        headers: { 'idempotency-key': key },
        body: { amount },
      });
      if (outcome.kind !== 'fault') return outcome;
      const mayRetry = outcome.committed !== 'yes' && outcome.retryable; // the key makes 'unknown' safe
      if (!mayRetry || attempt === 3) return outcome; // at most three attempts
      await pause(delayOf(outcome.retryAfter));
    }
  }

  return { pay };
}

describe('the README’s Retrying', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('a Caller retries a timed-out call with the same idempotency key and receives the stored Success once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const provider = providerOf();
    const keys: (string | null)[] = [];
    let responseLost = true;
    const lossy = async (request: Request) => {
      keys.push(request.headers.get('idempotency-key'));
      const response = await provider.http(request);
      if (responseLost) {
        responseLost = false;
        throw new DOMException('The operation timed out', 'TimeoutError');
      }
      return response;
    };
    const { pay } = readmePay(lossy);

    const paying = pay(120);
    await vi.runAllTimersAsync();
    const outcome = await paying;

    expect(outcome).toEqual({ kind: 'success', status: 201, body: { id: 'p-1', amount: 120 } });
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(provider.created.size).toBe(1);
  });

  test('a Caller does not retry a call whose Fault is committed unknown without an idempotency key', async () => {
    let sent = 0;
    const timesOutAfterSending = async (): Promise<Response> => {
      sent += 1;
      throw new DOMException('The operation timed out', 'TimeoutError');
    };
    const payments = client(paymentsDependency, {
      baseUrl: 'https://payments.test',
      headers: { 'x-api-key': settings.paymentsKey },
      fetch: timesOutAfterSending,
    });

    let outcome = await payments.getPayment({ params: { paymentId } });
    for (let attempt = 1; attempt < 3; attempt += 1) {
      if (outcome.kind !== 'fault' || outcome.committed !== 'no' || !outcome.retryable) break;
      outcome = await payments.getPayment({ params: { paymentId } });
    }

    expect(outcome).toMatchObject({
      kind: 'fault',
      source: 'timeout',
      committed: 'unknown',
      retryable: true,
    });
    expect(sent).toBe(1);
  });

  test('a Caller waits for Retry-After before it retries a retryable Fault', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const provider = providerOf();
    let sent = 0;
    const busyOnce = async (request: Request) => {
      sent += 1;
      if (sent > 1) return provider.http(request);
      const busy = { fault: { committed: 'no', retryable: true, message: 'Busy' } };
      return Response.json(busy, { status: 503, headers: { 'retry-after': '30' } });
    };
    const { pay } = readmePay(busyOnce);

    const paying = pay(120);
    await vi.advanceTimersByTimeAsync(29_999);
    const sentBefore = sent;
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await paying;

    expect(sentBefore).toBe(1);
    expect(outcome).toMatchObject({ kind: 'success', status: 201 });
    expect(sent).toBe(2);
  });

  test('a Caller waits until the HTTP date a Retry-After names', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-10-27T10:00:00Z'));
    const provider = providerOf();
    let sent = 0;
    const busyOnce = async (request: Request) => {
      sent += 1;
      if (sent > 1) return provider.http(request);
      const busy = { fault: { committed: 'no', retryable: true, message: 'Busy' } };
      const headers = { 'retry-after': 'Tue, 27 Oct 2026 10:00:10 GMT' };
      return Response.json(busy, { status: 503, headers });
    };
    const { pay } = readmePay(busyOnce);

    const paying = pay(120);
    await vi.advanceTimersByTimeAsync(9_999);
    const sentBefore = sent;
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await paying;

    expect(sentBefore).toBe(1);
    expect(outcome).toMatchObject({ kind: 'success', status: 201 });
  });

  test('a Caller waits a second when Retry-After is neither seconds nor a date', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const provider = providerOf();
    let sent = 0;
    const busyOnce = async (request: Request) => {
      sent += 1;
      if (sent > 1) return provider.http(request);
      const busy = { fault: { committed: 'no', retryable: true, message: 'Busy' } };
      return Response.json(busy, { status: 503, headers: { 'retry-after': 'soon' } });
    };
    const { pay } = readmePay(busyOnce);

    const paying = pay(120);
    await vi.advanceTimersByTimeAsync(999);
    const sentBefore = sent;
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await paying;

    expect(sentBefore).toBe(1);
    expect(outcome).toMatchObject({ kind: 'success', status: 201 });
  });
});
