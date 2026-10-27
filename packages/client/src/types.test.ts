import {
  type Committed as ContractCommitted,
  type Http as ContractHttp,
  type Issue as ContractIssue,
  type ReservedCode as ContractReservedCode,
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineRejection,
  defineService,
  type Endpoint,
  notFound,
  type ProvidedStandardRejections,
} from '@cf-loom/contract';
import { snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import type { Http as ServerHttp } from '@cf-loom/server';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import {
  type CallInput,
  type CallOptions,
  type Client,
  type ClientOptions,
  type Committed,
  client,
  type DeprecationNotice,
  type FaultSource,
  type Happened,
  type Http,
  type InferredFault,
  type Issue,
  type ReceivedFault,
  type ReceivedOutcome,
  type ReceivedRejection,
  type ReceivedSuccess,
  type ReceivedUnknownRejection,
  type ReservedCode,
} from './index.ts';

/** Every key any member of a union of records holds. */
type KeysOfEach<Record> = Record extends unknown ? keyof Record : never;

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'Locked',
  body: z.object({ lockedAt: z.string() }),
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  input: {
    params: z.object({ orderId: z.string() }),
    headers: z.object({ 'x-api-key': z.string(), 'x-region': z.enum(['eu', 'us']) }),
  },
  success: { status: 200, body: z.object({ id: z.string() }) },
  rejections: [notFound, orderLocked],
});

const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  input: {
    query: z.object({ page: z.int().optional() }),
    headers: z.object({ 'x-api-key': z.string(), 'x-region': z.string() }),
  },
  success: { status: 200, body: z.object({ ids: z.array(z.string()) }) },
});

const quotaExceeded = defineRejection({
  code: 'QUOTA_EXCEEDED',
  status: 429,
  message: 'Quota exceeded',
  headers: z.object({ 'x-quota-reset': z.string() }),
  body: z.object({ limit: z.int() }),
});

const putOrder = defineEndpoint({
  name: 'putOrder',
  method: 'PUT',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Replaces an order',
  input: { params: z.object({ orderId: z.string() }), body: z.object({ total: z.number() }) },
  success: {
    status: 200,
    headers: z.object({ etag: z.string() }),
    body: z.object({ id: z.string() }),
  },
  rejections: [quotaExceeded],
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
  const provided = providedEndpointsOf({ name, standardRejections }, endpoints, snapshot);
  return {
    name,
    endpoints: provided,
    events: {},
    standardRejections,
  };
}

const standards = providedStandardRejections({
  invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'Invalid' },
  notFound: { code: 'MISSING', status: 404, message: 'Missing' },
  notImplemented: { code: 'NOT_YET', status: 501, message: 'Not yet' },
});

const orders = contractPackageOf({ getOrder, listOrders, ping, putOrder }, standards);

const ordersDependency = defineDependency({
  endpoints: [orders.endpoints.getOrder, orders.endpoints.listOrders],
});

const replacingDependency = defineDependency({ endpoints: [orders.endpoints.putOrder] });

const baseUrl = 'http://orders.test';

describe('the client’s types', () => {
  test('has a method only for each Endpoint the Dependency lists', () => {
    const orders = client(ordersDependency, { baseUrl });

    expectTypeOf(orders).toHaveProperty('getOrder');
    expectTypeOf(orders).not.toHaveProperty('ping');
    expect(Object.keys(orders)).toEqual(['getOrder', 'listOrders']);
  });

  test('each method is named after the Endpoint it calls and typed by it, and no other name is', () => {
    const orders = client(ordersDependency, { baseUrl });

    expectTypeOf(orders.getOrder).toEqualTypeOf<Client<typeof ordersDependency>['getOrder']>();
    // @ts-expect-error ping is exported but not listed
    const unlisted = () => orders.ping;
    expect(unlisted).toBeTypeOf('function');
  });

  test('a required header not given to client() stays required on each call', () => {
    const orders = client(ordersDependency, { baseUrl, headers: { 'x-api-key': 'k' } });
    type Input = Parameters<typeof orders.getOrder>[0];

    expectTypeOf<{
      params: { orderId: string };
      headers: { 'x-region': 'eu' };
    }>().toExtend<Input>();
    expectTypeOf<{ params: { orderId: string } }>().not.toExtend<Input>();
    expect(orders).toBeDefined();
  });

  test('the first argument may be left out when no part of the Input is required', () => {
    const configured = client(ordersDependency, {
      baseUrl,
      headers: { 'x-api-key': 'k', 'x-region': 'eu' },
    });
    const bare = client(ordersDependency, { baseUrl });

    const leftOut = () => configured.listOrders();
    // @ts-expect-error: without the headers given, they are required, so the Input is too
    const required = () => bare.listOrders();

    expectTypeOf(configured.listOrders).toBeCallableWith();
    expectTypeOf<undefined>().not.toExtend<Parameters<typeof bare.listOrders>[0]>();
    expect([leftOut, required]).toHaveLength(2);
  });

  test('a header given to client() takes the Input’s type, across every Endpoint declaring it', () => {
    type Options = Parameters<typeof client<typeof ordersDependency, 'x-region'>>[1];
    type Region = NonNullable<Options['headers']>['x-region'];

    expectTypeOf<'eu'>().toExtend<Region>();
    expectTypeOf<'fr'>().not.toExtend<Region>();
    expectTypeOf<() => Promise<'us'>>().toExtend<Region>();
    expect(client).toBeDefined();
  });

  test('a header function may take the call’s options or none, and an onDeprecation may be async', () => {
    type Options = Parameters<typeof client<typeof ordersDependency, 'x-region'>>[1];
    type Region = NonNullable<Options['headers']>['x-region'];

    expectTypeOf<() => 'us'>().toExtend<Region>();
    expectTypeOf<(call: CallOptions) => Promise<'us'>>().toExtend<Region>();
    expectTypeOf<(forceRefresh?: boolean) => 'us'>().not.toExtend<Region>();
    expectTypeOf<(notice: DeprecationNotice) => Promise<void>>().toExtend<
      NonNullable<Options['onDeprecation']>
    >();
    expect(client).toBeDefined();
  });

  test('Client<typeof dependency, names> is what client() returns with those headers given', () => {
    const configured: Client<typeof ordersDependency, 'x-api-key'> = client(ordersDependency, {
      baseUrl,
      headers: { 'x-api-key': 'k' },
    });

    expectTypeOf(configured).toEqualTypeOf<Client<typeof ordersDependency, 'x-api-key'>>();
    expect(configured).toBeDefined();
  });

  test('inside a Rejection a switch on code narrows its body and is exhaustive, the Provider’s Standard codes included', () => {
    type Rejection = Extract<
      ReceivedOutcome<typeof ordersDependency, 'getOrder'>,
      { kind: 'rejection' }
    >;
    const described = (rejection: Rejection): string | number | undefined => {
      switch (rejection.code) {
        case 'ORDER_LOCKED':
          expectTypeOf(rejection.body).toEqualTypeOf<{ lockedAt: string }>();
          return rejection.body.lockedAt;
        case 'BAD_REQUEST':
          return rejection.body.issues.length;
        case 'MISSING':
        case 'NOT_YET':
          expectTypeOf(rejection).not.toHaveProperty('body');
          return undefined;
        default:
          return rejection satisfies never;
      }
    };

    const locked = { lockedAt: '2026-10-18T10:00:00Z' };
    expect(
      described({
        kind: 'rejection',
        source: 'provider',
        code: 'ORDER_LOCKED',
        status: 409,
        message: 'Locked',
        body: locked,
      }),
    ).toBe(locked.lockedAt);
  });

  test('a code the Endpoint does not answer is no Rejection of it', () => {
    type Outcome = ReceivedOutcome<typeof ordersDependency, 'getOrder'>;

    expectTypeOf<Extract<Outcome, { kind: 'rejection' }>['code']>().toEqualTypeOf<
      'MISSING' | 'ORDER_LOCKED' | 'BAD_REQUEST' | 'NOT_YET'
    >();
    expectTypeOf<Extract<Outcome, { kind: 'unknown-rejection' }>['code']>().toEqualTypeOf<string>();
    expect(standards.notFound.code).toBe('MISSING');
  });

  test('a Success body is typed by what its Endpoint declares, and the invalid-input source by who answered', () => {
    type Success = ReceivedSuccess<typeof ordersDependency, 'getOrder'>;
    type Invalid = Extract<
      ReceivedRejection<typeof ordersDependency, 'getOrder'>,
      { code: 'BAD_REQUEST' }
    >;

    expectTypeOf<Success['body']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<Invalid['source']>().toEqualTypeOf<'provider' | 'client'>();
    expect(standards.invalidInput.code).toBe('BAD_REQUEST');
  });

  test('a Configured name no Input declares is refused, in Client, ClientOptions and CallInput', () => {
    // @ts-expect-error: no listed Endpoint's Input declares x-api-kee
    expectTypeOf<Client<typeof ordersDependency, 'x-api-kee'>>().toBeObject();
    // @ts-expect-error: no listed Endpoint's Input declares x-api-kee
    expectTypeOf<ClientOptions<typeof ordersDependency, 'x-api-kee'>>().toBeObject();
    // @ts-expect-error: getOrder's Input declares no x-api-kee
    expectTypeOf<CallInput<typeof getOrder, 'x-api-kee'>>().toBeObject();
    expectTypeOf<Client<typeof ordersDependency, 'x-api-key'>>().toBeObject();
    expect(standards.notFound.code).toBe('MISSING');
  });

  test('Committed, Issue and ReservedCode import from the client and from the contract alike', () => {
    expectTypeOf<Committed>().toEqualTypeOf<ContractCommitted>();
    expectTypeOf<Issue>().toEqualTypeOf<ContractIssue>();
    expectTypeOf<ReservedCode>().toEqualTypeOf<ContractReservedCode>();
    expectTypeOf<Committed>().toEqualTypeOf<'no' | 'yes' | 'unknown'>();
    expect(standards.notFound.code).toBe('MISSING');
  });

  test('the invalid-input body’s in and code admit a value a later cf-loom adds, as { unknown }', () => {
    type Outcome = ReceivedOutcome<typeof ordersDependency, 'getOrder'>;
    type Rejection = Extract<Outcome, { readonly kind: 'rejection' }>;
    type Body = Extract<Rejection, { readonly code: 'BAD_REQUEST' }>['body'];
    type Issue = Body['issues'][number];

    expectTypeOf<{ unknown: string }>().toExtend<Issue['code']>();
    expectTypeOf<{ unknown: string }>().toExtend<Issue['in']>();
    expectTypeOf<'required'>().toExtend<Issue['code']>();
    expect(standards.invalidInput.code).toBe('BAD_REQUEST');
  });

  test('a method returns exactly ReceivedOutcome of its Dependency and Endpoint name', () => {
    type Returned = Awaited<ReturnType<Client<typeof ordersDependency>['listOrders']>>;

    expectTypeOf<Returned>().toEqualTypeOf<
      ReceivedOutcome<typeof ordersDependency, 'listOrders'>
    >();
    // @ts-expect-error: only an Endpoint the Dependency lists has an Outcome
    expectTypeOf<ReceivedOutcome<typeof ordersDependency, 'ping'>>().toBeObject();
    expect(ordersDependency.endpoints.map(({ name }) => name)).toContain('listOrders');
  });
});

describe('the client’s options, typed by what they declare', () => {
  test('an options variable holding baseUrl and a misspelled inferFault is a type error', () => {
    const options = { baseUrl, inferFalt: () => undefined };

    // @ts-expect-error inferFalt is not a declared field
    const clientOf = () => client(ordersDependency, options);

    expect(clientOf).toBeTypeOf('function');
  });

  test('an options variable holding headers and a misspelled fetch is a type error', () => {
    const options = { baseUrl, headers: { 'x-api-key': 'k' }, fetc: () => undefined };

    // @ts-expect-error fetc is not a declared field
    const clientOf = () => client(ordersDependency, options);

    expect(clientOf).toBeTypeOf('function');
  });

  test('an options variable holding only declared fields is accepted', () => {
    const options = { baseUrl, inferFault: () => undefined, onDeprecation: () => undefined };
    const typed: ClientOptions<typeof ordersDependency> = { baseUrl };

    const clients = [client(ordersDependency, options), client(ordersDependency, typed)];

    expect(clients).toHaveLength(2);
  });

  test('a header given to client() through a variable is no longer required on each call', () => {
    const options = { baseUrl, headers: { 'x-api-key': 'k' } };
    const orders = client(ordersDependency, options);
    type Input = Parameters<typeof orders.getOrder>[0];

    expectTypeOf<{
      params: { orderId: string };
      headers: { 'x-region': 'eu' };
    }>().toExtend<Input>();
    expectTypeOf<{ params: { orderId: string } }>().not.toExtend<Input>();
    expect(orders).toBeDefined();
  });

  test('a function written inline in the options gets its parameter types', () => {
    const orders = client(ordersDependency, {
      baseUrl,
      inferFault: (_happened, inferred) => {
        expectTypeOf(inferred.retryable).toEqualTypeOf<boolean>();
        return undefined;
      },
      onDeprecation: (notice) => {
        expectTypeOf(notice).toEqualTypeOf<DeprecationNotice>();
      },
    });

    expect(orders).toBeDefined();
  });
});

describe('Http', () => {
  test('the global fetch is an Http, and a function of a URL and an init is not', () => {
    expectTypeOf<typeof globalThis.fetch>().toExtend<Http>();
    expectTypeOf<(url: string, init: RequestInit) => Promise<Response>>().not.toExtend<Http>();
    expect(typeof globalThis.fetch).toBe('function');
  });

  test('the client, the server and the contract export one Http', () => {
    expectTypeOf<Http>().toEqualTypeOf<ServerHttp>();
    expectTypeOf<Http>().toEqualTypeOf<ContractHttp>();
    expectTypeOf<ContractHttp>().toEqualTypeOf<(request: Request) => Promise<Response>>();
  });
});

describe('a Fault’s source', () => {
  test('a switch on it is exhaustive over the nine sources', () => {
    type Fault = Extract<ReceivedOutcome<typeof ordersDependency, 'getOrder'>, { kind: 'fault' }>;
    const described = (source: Fault['source']): string => {
      switch (source) {
        case 'provider':
        case 'invalid-outcome':
          return 'the Provider answered';
        case 'status':
        case 'unreadable-body':
          return 'a response arrived';
        case 'aborted':
        case 'timeout':
        case 'no-connection':
        case 'connection-lost':
        case 'connection-failed':
          return 'the client met';
        default:
          return source satisfies never;
      }
    };

    expectTypeOf<FaultSource>().toEqualTypeOf<
      | 'provider'
      | 'aborted'
      | 'timeout'
      | 'no-connection'
      | 'connection-lost'
      | 'connection-failed'
      | 'status'
      | 'unreadable-body'
      | 'invalid-outcome'
    >();
    expectTypeOf<Fault['source']>().toEqualTypeOf<FaultSource>();
    expect(described('timeout')).toBe('the client met');
  });
});

describe('the records a Caller passes and reads', () => {
  test('a CallInput holds the parts its Endpoint declares: params, query, headers and body', () => {
    expectTypeOf<keyof CallInput<typeof getOrder>>().toEqualTypeOf<'params' | 'headers'>();
    expectTypeOf<keyof CallInput<typeof listOrders>>().toEqualTypeOf<'query' | 'headers'>();
    expectTypeOf<keyof CallInput<typeof putOrder>>().toEqualTypeOf<'params' | 'body'>();
  });

  test('CallOptions hold the signal, and no more', () => {
    expectTypeOf<keyof CallOptions>().toEqualTypeOf<'signal'>();
  });

  test('ClientOptions hold the base URL, headers, fetch, inference and Deprecation hook, and no more', () => {
    expectTypeOf<keyof ClientOptions<typeof ordersDependency>>().toEqualTypeOf<
      'baseUrl' | 'headers' | 'fetch' | 'inferFault' | 'onDeprecation'
    >();
  });

  test('a DeprecationNotice holds the Provider, the Endpoint and the instant, and no more', () => {
    expectTypeOf<keyof DeprecationNotice>().toEqualTypeOf<
      'provider' | 'endpoint' | 'deprecatedAt'
    >();
  });

  test('a ReceivedSuccess holds the status, headers and body its Endpoint declares, and no more', () => {
    expectTypeOf<
      KeysOfEach<ReceivedSuccess<typeof replacingDependency, 'putOrder'>>
    >().toEqualTypeOf<'kind' | 'status' | 'headers' | 'body'>();
  });

  test('a ReceivedRejection holds its source, code, status, message, and the headers and body its code declares', () => {
    expectTypeOf<
      KeysOfEach<ReceivedRejection<typeof replacingDependency, 'putOrder'>>
    >().toEqualTypeOf<'kind' | 'source' | 'code' | 'status' | 'message' | 'headers' | 'body'>();
  });

  test('a ReceivedUnknownRejection holds its source, code, status, message and body, and no more', () => {
    expectTypeOf<keyof ReceivedUnknownRejection>().toEqualTypeOf<
      'kind' | 'source' | 'code' | 'status' | 'message' | 'body'
    >();
  });

  test('a ReceivedFault holds its source, whether it committed and may be retried, and what the response said, and no more', () => {
    expectTypeOf<keyof ReceivedFault>().toEqualTypeOf<
      | 'kind'
      | 'source'
      | 'committed'
      | 'retryable'
      | 'message'
      | 'status'
      | 'code'
      | 'retryAfter'
      | 'cause'
      | 'issues'
    >();
  });

  test('what Happened holds the error, status and headers a call met, beside its kind, and no more', () => {
    expectTypeOf<KeysOfEach<Happened>>().toEqualTypeOf<'kind' | 'error' | 'status' | 'headers'>();
  });

  test('an InferredFault holds whether it committed and may be retried, and no more', () => {
    expectTypeOf<keyof InferredFault>().toEqualTypeOf<'committed' | 'retryable'>();
  });
});
