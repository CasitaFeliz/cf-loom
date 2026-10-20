import { client } from '@casitafeliz/loom-client';
import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Endpoint,
  notFound,
  openEnum,
  openEnumReader,
} from '@casitafeliz/loom-contract';
import {
  exportedSnapshotOf,
  snapshotOf,
  validateContract,
} from '@casitafeliz/loom-contract/internal';
import { admit, fault, handle, reject, success } from '@casitafeliz/loom-handlers';
import { serve } from '@casitafeliz/loom-server';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
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
    input: { params: z.object({ paymentId: z.string().min(3) }) },
    success: {
      status: 200,
      headers: z.object({ 'x-stage': stage, 'x-count': z.number() }),
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
function contractPackageOf<const Endpoints extends ContractPackage['endpoints']>(
  endpoints: Endpoints,
  declaredEndpoints: readonly Endpoint[],
) {
  const listed = declaredEndpoints as unknown as [Endpoint];
  const group = defineGroup({ name: 'payments', description: 'Payments', endpoints: listed });
  const root = defineContract({ name: 'payments-service', groups: [group] });
  const rootPackage = {
    packageName: 'payments-service',
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
  const standardRejections = {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  } as const;
  const name = 'payments-service';
  return { name, version: '1.0.0', endpoints, events: {}, standardRejections, exportedSnapshot };
}

const paymentsDeps = defineDependencies(
  contractPackageOf({ getPayment: readers.getPayment, capturePayment: readers.capturePayment }, [
    getPayment,
    capturePayment,
  ]),
  { endpoints: [readers.getPayment, readers.capturePayment] },
);

const headers = { 'x-stage': 'settled', 'x-count': 0.000_000_15 } as const;
const body = { stage: 'pending', id: 'pay-1', amount: 5 } as const;
const locked = { reason: 'settled', lockedAt: '2026-10-19T10:00:00Z' } as const;

/** The Provider itself, its Handler answering by the payment asked for. */
const served = serve(
  defineContract({
    name: 'payments-service',
    groups: [
      defineGroup({
        name: 'payments',
        description: 'Payments',
        endpoints: [getPayment, capturePayment],
      }),
    ],
  }),
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
          default:
            return success({ headers, body });
        }
      }),
      capturePayment: handle(capturePayment, () => success()),
    },
    guards: {},
    deprecatedAt: { getPayment: '1970-01-01T00:00:00Z' },
  },
);

/** The fake, scripted to answer each payment as the Provider's Handler does. */
function scriptedFake() {
  const payments = fakeProvider(paymentsDeps, { baseUrl: 'http://payments.test' });
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

describe('fakeProvider and serve answer alike', () => {
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
    const fromFake = await seenOf(await scriptedFake().fetch(url, init));

    expect(fromFake).toEqual(fromServe);
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

const refundDeps = defineDependencies(
  contractPackageOf({ refundPayment: packagedRefund }, [refundPayment]),
  { endpoints: [packagedRefund] },
);

/** The Provider of `refundPayment`, every GuardHandler admitting, so no run stops the reading. */
const servedRefund = serve(
  defineContract({
    name: 'payments-service',
    groups: [
      defineGroup({ name: 'payments', description: 'Payments', endpoints: [refundPayment] }),
    ],
  }),
  {
    endpoints: { refundPayment: handle(refundPayment, () => success()) },
    guards: { merchant: handle(merchant, () => admit()), region: handle(region, () => admit()) },
    deprecatedAt: {},
  },
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
      'a Guard’s demands failing beside a malformed body and a bad param answer alone',
      { params: { paymentId: 'ab' }, query: valid.query, headers: { 'x-region': 'eu' } },
    ],
    ['a declared body left out', { ...valid, body: undefined }],
    [
      'a body that breaks its schema beside a bad param answers both together',
      { ...valid, params: { paymentId: 'ab' }, body: { amount: 'x' } },
    ],
  ])('%s', async (_name, input) => {
    const [url, init] = requestOf(input);
    const fake = fakeProvider(refundDeps, { baseUrl: 'http://payments.test' });
    fake.on('refundPayment').otherwise((r) => r.success());
    const caller = client(refundDeps, {
      baseUrl: 'http://payments.test',
      fetch: (sentUrl, sentInit) => servedRefund(new Request(sentUrl, sentInit)),
    });

    const fromServe = await seenOf(await servedRefund(new Request(url, init)));
    const fromFake = await seenOf(await fake.fetch(url, init));
    const fromClient = await caller.refundPayment(input as never);

    expect(fromFake).toEqual(fromServe);
    expect(answerOf(fromClient)).toEqual(answerOfSeen(fromServe));
  });
});
