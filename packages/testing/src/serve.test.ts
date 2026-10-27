import { client } from '@cf-loom/client';
import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Endpoint,
  notFound,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { admit, fault, handle, reject, success } from '@cf-loom/handlers';
import { type ServedFault, serve } from '@cf-loom/server';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { fakeProvider } from './index.ts';

/** The payments Endpoints, with a schema for each Open Enum: as declared, or as read. */
function paymentEndpointsOf<const Stage extends z.ZodType>(stage: Stage) {
  const paymentLocked = defineRejection({
    code: 'PAYMENT_LOCKED',
    status: 409,
    message: 'The payment is locked',
    body: z.object({ reason: stage, lockedAt: z.iso.datetime() }),
  });
  const getPayment = defineEndpoint({
    name: 'getPayment',
    method: 'GET',
    path: '/payments/:paymentId',
    visibility: 'internal',
    description: 'One payment',
    lifecycle: 'deprecated',
    deprecatedAt: '1970-01-01T00:00:00Z',
    input: { params: z.object({ paymentId: z.string().min(3) }) },
    success: {
      status: 200,
      headers: z.object({
        'x-stage': stage,
        'x-count': z.number(),
        'x-note': z.string().optional(),
      }),
      body: z.object({ stage, id: z.string(), amount: z.int() }),
    },
    rejections: [notFound, paymentLocked],
  });
  const capturePayment = defineEndpoint({
    name: 'capturePayment',
    method: 'POST',
    path: '/payments/:paymentId/capture',
    visibility: 'internal',
    description: 'Captures a payment',
    input: { params: z.object({ paymentId: z.string() }), body: z.object({ amount: z.int() }) },
    success: { status: 204 },
  });
  return { getPayment, capturePayment, paymentLocked };
}

const declared = paymentEndpointsOf(openEnum(['pending', 'settled']));
const readers = paymentEndpointsOf(openEnumReader(['pending', 'settled']));
const { getPayment, capturePayment, paymentLocked } = declared;

/** The Provider's Contract Package, as `cf-loom package` writes it from its declarations. */
function contractPackageOf<const Endpoints extends Readonly<Record<string, Exportable>>>(
  endpoints: Endpoints,
  declaredEndpoints: readonly Endpoint[],
) {
  const listed = declaredEndpoints as unknown as [Endpoint];
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
  const standardRejections = providedStandardRejections();
  const name = 'payments-service';
  const provided = providedEndpointsOf({ name, standardRejections }, endpoints, snapshot);
  return {
    name,
    endpoints: provided,
    events: {},
    standardRejections,
  };
}

const paymentsDependencyPackage = contractPackageOf(
  { getPayment: readers.getPayment, capturePayment: readers.capturePayment },
  [getPayment, capturePayment],
);
const paymentsDependency = defineDependency({
  endpoints: [
    paymentsDependencyPackage.endpoints.getPayment,
    paymentsDependencyPackage.endpoints.capturePayment,
  ],
});

const headers = { 'x-stage': 'settled', 'x-count': 0.000_000_15 } as const;
const body = { stage: 'pending', id: 'pay-1', amount: 5 } as const;
const unsendable = { ...headers, 'x-note': 'a\nb' } as const;
const locked = { reason: 'settled', lockedAt: '2026-10-19T10:00:00Z' } as const;

/** What the Provider reports to its Service through `onServiceFault`. */
const serviceFaults: ServedFault[] = [];

/** The Provider's Contract. */
const paymentsService = defineService({
  name: 'payments-service',
  groups: [
    defineGroup({
      name: 'payments',
      description: 'Payments',
      endpoints: [getPayment, capturePayment],
    }),
  ],
});

/** The Provider itself, its Handler answering by the payment asked for. */
const served = serve(
  paymentsService,
  {
    endpoints: {
      getPayment: handle(getPayment, ({ params }) => {
        switch (params.paymentId) {
          case 'missing':
            return reject(notFound);
          case 'locked':
            return reject(paymentLocked, locked);
          case 'down':
            return fault({ committed: 'no', retryable: true });
          case 'unsendable':
            return success({ headers: unsendable, body });
          default:
            return success({ headers, body });
        }
      }),
      capturePayment: handle(capturePayment, () => success()),
    },
    guards: {},
  },
  {
    onServiceFault: (serviceFault) => {
      serviceFaults.push(serviceFault);
    },
  },
);

/** The fake, scripted to answer each payment as the Provider's Handler does. */
function scriptedFake() {
  const payments = fakeProvider(paymentsDependency, { baseUrl: 'http://payments.test' });
  payments.on('getPayment').otherwise((builder, { params }) => {
    switch (params.paymentId) {
      case 'missing':
        return builder.reject('NOT_FOUND');
      case 'locked':
        return builder.reject('PAYMENT_LOCKED', locked);
      case 'down':
        return builder.fault({ committed: 'no', retryable: true });
      default:
        return builder.success({ headers, body });
    }
  });
  payments.on('capturePayment').otherwise((r) => r.success());
  return payments;
}

/** What a Caller can see of a response: its status, the headers that matter, its JSON value. */
async function seenOf(response: Response) {
  const named = ['content-type', 'deprecation', 'x-stage', 'x-count'];
  const text = await response.text();
  return {
    status: response.status,
    headers: named.map((name) => response.headers.get(name)),
    body: text === '' ? undefined : JSON.parse(text),
  };
}

const capture = (body: string, contentType = 'application/json'): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': contentType },
  body,
});

/** Every Fault `fault()` builds from what a Handler gives it, a message given or not. */
const faultsGiven = (['no', 'yes', 'unknown'] as const).flatMap((committed) =>
  [undefined, 'Down for now'].flatMap((message) =>
    [
      { retryable: false },
      { retryable: true },
      { retryable: true, retryAfter: 0 },
      { retryable: true, retryAfter: 30 },
    ].map((given) => ({ committed, ...given, ...(message === undefined ? {} : { message }) })),
  ),
);

/** The Provider itself, its Handler returning the Fault it is given. */
function servedFaultOf(given: (typeof faultsGiven)[number]) {
  const endpoints = {
    getPayment: handle(getPayment, () => fault(given as never)),
    capturePayment: handle(capturePayment, () => success()),
  };
  return serve(paymentsService, { endpoints, guards: {} }, { onServiceFault: () => undefined });
}

describe('fakeProvider and serve answer alike', () => {
  test('a code another Endpoint declares, sent by r.unknownRejection, is answered with the bytes serve sends for it', async () => {
    const payments = fakeProvider(paymentsDependency, { baseUrl: 'http://payments.test' });
    payments
      .on('capturePayment')
      .otherwise((r) => r.unknownRejection('PAYMENT_LOCKED', { body: locked }));

    const fromServe = await served(new Request('http://payments.test/payments/locked'));
    const fromFake = await payments.fetch(
      new Request('http://payments.test/payments/pay-1/capture', capture('{"amount":1}')),
    );

    expect(fromFake.status).toBe(fromServe.status);
    expect(fromFake.headers.get('content-type')).toBe(fromServe.headers.get('content-type'));
    expect(await fromFake.text()).toBe(await fromServe.text());
  });

  test.each(faultsGiven)(
    'the Fault %j is answered with the bytes serve sends for it, Retry-After included',
    async (given) => {
      const payments = fakeProvider(paymentsDependency, { baseUrl: 'http://payments.test' });
      payments.on('getPayment').otherwise((r) => r.fault(given as never));
      const url = 'http://payments.test/payments/pay-1';

      const fromServe = await servedFaultOf(given)(new Request(url));
      const fromFake = await payments.fetch(new Request(url));

      expect(fromFake.status).toBe(fromServe.status);
      expect(fromFake.headers.get('retry-after')).toBe(fromServe.headers.get('retry-after'));
      expect(fromFake.headers.get('content-type')).toBe(fromServe.headers.get('content-type'));
      expect(await fromFake.text()).toBe(await fromServe.text());
    },
  );

  test('a request a Retired Endpoint the Provider does not export wins is answered with the bytes serve sends for it', async () => {
    const retired = defineEndpoint({
      name: 'getLatestPayment',
      method: 'GET',
      path: '/payments/latest',
      visibility: 'internal',
      lifecycle: 'retired',
      description: 'The latest payment',
      success: { status: 200, body: z.object({ id: z.string() }) },
    });
    const endpoints = [getPayment, capturePayment, retired] as const;
    const group = defineGroup({ name: 'payments', description: 'Payments', endpoints });
    const root = defineService({ name: 'payments-service', groups: [group] });
    const handlers = {
      getPayment: handle(getPayment, () => success({ headers, body })),
      capturePayment: handle(capturePayment, () => success()),
    };
    const providing = serve(root, { endpoints: handlers, guards: {} }, {});
    const provider = contractPackageOf(
      { getPayment: readers.getPayment, capturePayment: readers.capturePayment },
      endpoints,
    );
    const dependency = defineDependency({
      endpoints: [provider.endpoints.getPayment],
    });
    const payments = fakeProvider(dependency, { baseUrl: 'http://payments.test' });
    const url = 'http://payments.test/payments/latest';

    const fromServe = await providing(new Request(url));
    const fromFake = await payments.fetch(new Request(url));

    expect(fromServe.status).toBe(410);
    expect(fromFake.status).toBe(fromServe.status);
    expect(fromFake.headers.get('content-type')).toBe(fromServe.headers.get('content-type'));
    expect(await fromFake.text()).toBe(await fromServe.text());
  });

  test.each(['/p/a/b', '/p/q/b'])(
    'a request to %s, which an exported Endpoint matches, is answered with the bytes serve sends for it',
    async (path) => {
      const base = { method: 'GET', description: 'An Endpoint', success: { status: 204 } } as const;
      const first = defineEndpoint({
        ...base,
        name: 'getFirst',
        path: '/p/:x/b',
        visibility: 'internal',
        input: { params: z.object({ x: z.string() }) },
      });
      const retired = defineEndpoint({
        ...base,
        name: 'getRetired',
        path: '/p/a/:y',
        visibility: 'internal',
        lifecycle: 'retired',
        input: { params: z.object({ y: z.string() }) },
      });
      const hidden = defineEndpoint({
        ...base,
        name: 'getHidden',
        path: '/p/a/c',
        visibility: 'private',
      });
      const endpoints = [first, retired, hidden] as const;
      const group = defineGroup({ name: 'payments', description: 'Payments', endpoints });
      const root = defineService({ name: 'payments-service', groups: [group] });
      const handlers = {
        getFirst: handle(first, () => success()),
        getHidden: handle(hidden, () => success()),
      };
      const providing = serve(root, { endpoints: handlers, guards: {} }, {});
      const provider = contractPackageOf({ getFirst: first }, endpoints);
      const dependency = defineDependency({ endpoints: [provider.endpoints.getFirst] });
      const paths = fakeProvider(dependency, { baseUrl: 'http://payments.test' });
      paths.on('getFirst').otherwise((r) => r.success());
      const url = `http://payments.test${path}`;

      const fromServe = await providing(new Request(url));
      const fromFake = await paths.fetch(new Request(url));

      expect(fromFake.status).toBe(fromServe.status);
      expect(fromFake.headers.get('content-type')).toBe(fromServe.headers.get('content-type'));
      expect(await fromFake.text()).toBe(await fromServe.text());
    },
  );

  test.each([
    ['a Success with its headers', '/payments/pay-1', {}],
    ['a Standard Rejection', '/payments/missing', {}],
    ['a declared Rejection with its body', '/payments/locked', {}],
    ['a Fault', '/payments/down', {}],
    ['invalid Input', '/payments/ab', {}],
    ['a Success with no body', '/payments/pay-1/capture', capture('{"amount":1}')],
    ['a wrong content type', '/payments/pay-1/capture', capture('{}', 'text/plain')],
    ['a body that is no JSON', '/payments/pay-1/capture', capture('nope')],
    ['a body that breaks its schema', '/payments/pay-1/capture', capture('{"amount":"1"}')],
  ])('%s', async (_name, path, init) => {
    const url = `http://payments.test${path}`;

    const fromServe = await seenOf(await served(new Request(url, init)));
    const fromFake = await seenOf(await scriptedFake().fetch(new Request(url, init)));

    expect(fromFake).toEqual(fromServe);
  });

  test('a Success header that cannot travel: serve answers INVALID_OUTCOME and the fake calls the script a mistake at the same header', async () => {
    const url = 'http://payments.test/payments/unsendable';
    const payments = fakeProvider(paymentsDependency, { baseUrl: 'http://payments.test' });
    payments.on('getPayment').otherwise((r) => r.success({ headers: unsendable, body }));
    serviceFaults.length = 0;

    const fromServe = await served(new Request(url));
    const fromFake = payments.fetch(new Request(url));

    await expect(fromFake).rejects.toThrow(/success\.headers\.x-note invalid_format/);
    expect(await fromServe.json()).toMatchObject({ fault: { code: 'INVALID_OUTCOME' } });
    expect(serviceFaults).toEqual([
      {
        kind: 'invalid-outcome',
        declaration: expect.objectContaining({ name: 'getPayment' }),
        name: 'getPayment',
        issues: [
          {
            part: 'success.headers',
            path: ['x-note'],
            code: 'invalid_format',
            message: expect.any(String),
          },
        ],
      },
    ]);
  });
});

const merchant = defineGuard({
  name: 'merchant',
  description: 'The merchant a request acts for',
  demands: {
    headers: z.object({ 'x-merchant-key': z.string().min(4) }),
    query: z.object({ merchant: z.string() }),
  },
});

const region = defineGuard({
  name: 'region',
  description: 'The region a request is served in',
  demands: {
    headers: z.object({ 'x-region': z.enum(['eu', 'us']) }),
    query: z.object({ zone: z.string() }),
  },
});

const refundPayment = defineEndpoint({
  name: 'refundPayment',
  method: 'POST',
  path: '/payments/:paymentId/refund',
  visibility: 'internal',
  description: 'Refunds a payment',
  guards: [merchant, region],
  input: {
    params: z.object({ paymentId: z.string().min(3) }),
    body: z.object({ amount: z.int() }),
  },
  success: { status: 204 },
});

/** `refundPayment` as its Contract Package rebuilds it, the Guards' demands merged into its Input. */
const packagedRefund = defineEndpoint({
  name: 'refundPayment',
  method: 'POST',
  path: '/payments/:paymentId/refund',
  visibility: 'internal',
  description: 'Refunds a payment',
  guards: [merchant, region],
  input: {
    params: z.object({ paymentId: z.string().min(3) }),
    query: z.object({ merchant: z.string(), zone: z.string() }),
    headers: z.object({ 'x-merchant-key': z.string().min(4), 'x-region': z.enum(['eu', 'us']) }),
    body: z.object({ amount: z.int() }),
  },
  success: { status: 204 },
});

const refundDependencyPackage = contractPackageOf({ refundPayment: packagedRefund }, [
  refundPayment,
]);
const refundDependency = defineDependency({
  endpoints: [refundDependencyPackage.endpoints.refundPayment],
});

/** The Provider of `refundPayment`, every GuardHandler admitting, so no run stops the reading. */
const servedRefund = serve(
  defineService({
    name: 'payments-service',
    groups: [
      defineGroup({ name: 'payments', description: 'Payments', endpoints: [refundPayment] }),
    ],
  }),
  {
    endpoints: { refundPayment: handle(refundPayment, () => success()) },
    guards: { merchant: handle(merchant, () => admit()), region: handle(region, () => admit()) },
  },
  {},
);

/** A call's Input as a Caller passes it to `refundPayment`. */
type RefundInput = {
  readonly params: { readonly paymentId: string };
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
};

/** The request a call's Input travels as: no content type and no body when the body is left out. */
function requestOf({ params, query, headers, body }: RefundInput): [string, RequestInit] {
  const search = new URLSearchParams(query).toString();
  const url = `http://payments.test/payments/${params.paymentId}/refund?${search}`;
  if (body === undefined) {
    return [url, { method: 'POST', headers }];
  }
  const withType = { ...headers, 'content-type': 'application/json' };
  return [url, { method: 'POST', headers: withType, body: JSON.stringify(body) }];
}

/** What serve and the client agree on: a Success, or a Rejection's code and body. */
function answerOf(outcome: {
  readonly kind: string;
  readonly code?: string;
  readonly body?: unknown;
}) {
  if (outcome.kind !== 'rejection') {
    return { kind: outcome.kind };
  }
  return { kind: outcome.kind, code: outcome.code, body: outcome.body };
}

/** A response as `answerOf` reads an Outcome: a Rejection Envelope's code and body, or a Success. */
function answerOfSeen(seen: Awaited<ReturnType<typeof seenOf>>) {
  if (seen.body === undefined) {
    return answerOf({ kind: 'success' });
  }
  return answerOf({ kind: 'rejection', ...seen.body.rejection });
}

const valid = {
  params: { paymentId: 'pay-1' },
  query: { merchant: 'm-1', zone: 'z-1' },
  headers: { 'x-merchant-key': 'key-1', 'x-region': 'eu' },
  body: { amount: 5 },
} as const;

describe('serve, the client and fakeProvider read a request alike', () => {
  test.each<[string, RefundInput]>([
    ['a valid request', valid],
    [
      'both Guards’ demands failing answer the first Guard’s alone',
      { ...valid, query: {}, headers: {} },
    ],
    [
      'the second Guard’s demands failing answer alone',
      { ...valid, query: { merchant: 'm-1' }, headers: { ...valid.headers, 'x-region': 'mars' } },
    ],
    [
      'a Guard’s demands failing beside a body left out and a bad param answer alone',
      { params: { paymentId: 'ab' }, query: valid.query, headers: { 'x-region': 'eu' } },
    ],
    ['a declared body left out', { ...valid, body: undefined }],
    [
      'a body that breaks its schema beside a bad param answers both together',
      { ...valid, params: { paymentId: 'ab' }, body: { amount: 'x' } },
    ],
  ])('%s', async (_name, input) => {
    const [url, init] = requestOf(input);
    const fake = fakeProvider(refundDependency, { baseUrl: 'http://payments.test' });
    fake.on('refundPayment').otherwise((r) => r.success());
    const caller = client(refundDependency, {
      baseUrl: 'http://payments.test',
      fetch: servedRefund,
    });

    const fromServe = await seenOf(await servedRefund(new Request(url, init)));
    const fromFake = await seenOf(await fake.fetch(new Request(url, init)));
    const fromClient = await caller.refundPayment(input as never);

    expect(fromFake).toEqual(fromServe);
    expect(answerOf(fromClient)).toEqual(answerOfSeen(fromServe));
  });
});
