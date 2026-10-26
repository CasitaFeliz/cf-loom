import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { anInstalledContract, aRootPackage } from '../../test/root-package.ts';
import {
  type ContractPackage,
  defineApplication,
  defineCommand,
  defineDefinitions,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  defineSubscription,
  notFound,
  providedEndpoint,
  providedEvent,
  type Rejection,
} from '../index.ts';
import {
  canonicalTextOf,
  isEmptyTextPart,
  originPackagesOf,
  publishedSnapshotOf,
  type ResolvedContractPackage,
  type ResolvedDefinitions,
  type Root,
  type RootKind,
  type Snapshot,
  snapshotOf,
  validateRoot,
} from '../internal/index.ts';

const money = z.object({ amount: z.int(), currency: z.string() });

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
  headers: z.object({ 'www-authenticate': z.string().describe('The scheme to sign in with') }),
});
const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });
const unusedRejection = defineRejection({ code: 'UNUSED', status: 410, message: 'Unused' });

const userToken = defineGuard({
  name: 'userToken',
  description: 'A signed-in user',
  demands: { headers: z.object({ authorization: z.string().describe('From the Guard') }) },
  context: z.object({ userId: z.string() }),
  rejections: [unauthenticated],
});
const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken],
  qualifier: z.array(z.enum(['orders:read', 'orders:edit'])).min(1),
  rejections: [forbidden],
});
const unusedGuard = defineGuard({ name: 'unusedGuard', description: 'Attached by no Endpoint' });

const orgDefinitions = defineDefinitions({
  standardRejections: {
    invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'The request is invalid' },
  },
});

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ callerId: z.string() }),
  rejections: [unauthenticated],
});

function aGetOrder(
  rejections: readonly [typeof orderLocked | typeof notFound, typeof orderLocked | typeof notFound],
) {
  return defineEndpoint({
    name: 'getOrder',
    method: 'GET',
    path: '/orders/:orderId',
    visibility: 'public',
    description: 'One order by id',
    guards: [apiKey],
    input: {
      params: z.object({ orderId: z.uuid() }),
      headers: z.object({ 'x-trace': z.string().optional() }),
    },
    success: { status: 200, body: z.object({ id: z.uuid(), total: money }) },
    rejections,
  });
}

const getOrder = aGetOrder([orderLocked, notFound]);

const deprecatedAt = '2026-10-17T09:30:00Z';

const editOrder = defineEndpoint({
  name: 'editOrder',
  method: 'PATCH',
  path: '/orders/:orderId/lines/:lineId',
  visibility: 'internal',
  description: 'Edits one line',
  lifecycle: 'deprecated',
  deprecatedAt,
  guards: [userToken, { guard: permission, qualifier: ['orders:read', 'orders:edit'] }],
  input: {
    params: z.object({ orderId: z.uuid(), lineId: z.uuid() }),
    headers: z.object({
      authorization: z.string().optional().describe('From the Endpoint'),
    }),
    body: z.object({ quantity: z.int() }),
  },
  success: { status: 204, headers: z.object({ etag: z.string() }) },
});

const ordersGroup = defineGroup({
  name: 'orders',
  description: 'Order lifecycle',
  endpoints: [getOrder, editOrder],
});

const getPayment = providedEndpoint('payments-service', {
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'public',
  description: 'One payment by id',
  input: { params: z.object({ paymentId: z.uuid() }) },
  success: { status: 200, body: z.object({ amount: z.int() }) },
});
const listPayments = providedEndpoint('payments-service', {
  name: 'listPayments',
  method: 'GET',
  path: '/payments',
  visibility: 'public',
  description: 'Every payment',
  success: { status: 200, body: z.object({ count: z.int() }) },
});

const paymentSettledV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});
const paymentFailedV1 = providedEvent('payments-service', {
  name: 'PaymentFailed',
  version: 1,
  visibility: 'internal',
  description: 'A payment failed',
  body: z.object({ paymentId: z.uuid() }),
});

const payments = {
  name: 'payments-service',
  endpoints: { getPayment, listPayments },
  events: { paymentSettledV1, paymentFailedV1 },
  standardRejections: {
    invalidInput: {
      code: 'INVALID_INPUT',
      status: 400,
      message: 'Invalid input',
      body: z.object({ issues: z.array(z.unknown()) }),
    },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
  exportedSnapshot: {
    format: 1,
    defs: {},
    endpoints: {},
    events: {},
    guards: {},
    codes: {},
    shadowing: {},
  },
} as const satisfies ContractPackage;

/** The Contract Package of payments-service as installed beside the Roots under test: at 5.1.0. */
const paymentsPackage = anInstalledContract(payments, { version: '5.1.0' });

/** An Endpoint with the Provider's name as another package may export it: equal to getPayment, and not the same object. */
const aGetPaymentOfItsOwn = providedEndpoint('payments-service', {
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'public',
  description: 'One payment by id',
  input: { params: z.object({ paymentId: z.uuid() }) },
  success: { status: 200, body: z.object({ amount: z.int() }) },
});

const paymentsDependency = defineDependency({
  provider: payments,
  endpoints: [payments.endpoints.getPayment, payments.endpoints.listPayments],
});

const orgPackage: ResolvedDefinitions = {
  kind: 'identified',
  definitions: orgDefinitions,
  packageName: '@org/definitions',
  version: '4.2.0',
  reaches: [],
  exports: {
    definitions: orgDefinitions,
    userToken,
    permission,
    unusedGuard,
    money,
    unauthenticated,
    forbidden,
    unusedRejection,
  },
};

const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notifies the customer of each payment settled',
  event: payments.events.paymentSettledV1,
});
const notifyOnFailed = defineSubscription({
  name: 'notifyOnFailed',
  description: 'Notifies the customer of each payment failed',
  event: payments.events.paymentFailedV1,
});

const contract = defineService({
  name: 'orders-service',
  standardRejections: orgDefinitions,
  groups: [
    ordersGroup,
    defineGroup({
      name: 'messages',
      description: 'Messages',
      subscriptions: [notifyOnSettled, notifyOnFailed],
    }),
  ],
  dependencies: [paymentsDependency],
});

/** The Snapshot of a Root, beside the Definitions Packages installed, `@org/definitions` by default. */
function snapshotFor(
  root: Root,
  packages: readonly ResolvedDefinitions[] = [orgPackage],
  contractPackages: readonly ResolvedContractPackage[] = [paymentsPackage],
): Snapshot {
  const { definitions: _root, ...exported } = orgPackage.exports;
  const rootExports = root === orgDefinitions ? exported : {};
  const rootPackage = aRootPackage(root, { packages, contractPackages, rootExports });
  const validated = validateRoot(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  return snapshotOf(validated);
}

function serviceSnapshot(
  root: Root = contract,
  packages: readonly ResolvedDefinitions[] = [orgPackage],
  contractPackages: readonly ResolvedContractPackage[] = [paymentsPackage],
) {
  const snapshot = snapshotFor(root, packages, contractPackages);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return snapshot;
}

/** The merged query of an Endpoint with its own query and a Guard's demanded one. */
function searchQueryOf({
  own,
  demanded,
}: {
  readonly own?: z.ZodObject;
  readonly demanded: z.ZodObject;
}) {
  const tenant = defineGuard({
    name: 'tenant',
    description: 'A tenant by query',
    demands: { query: demanded },
  });
  const search = defineEndpoint({
    name: 'search',
    method: 'GET',
    path: '/search',
    visibility: 'public',
    description: 'Search',
    guards: [tenant],
    input: own === undefined ? {} : { query: own },
    success: { status: 200, body: z.object({ count: z.int() }) },
  });
  const group = defineGroup({ name: 'search', description: 'Search', endpoints: [search] });
  const root = defineService({ name: 'search-service', groups: [group] });
  return serviceSnapshot(root, []).endpoints['GET /search']?.input.query;
}

/**
 * A Service listing the Definitions Package, whose Public Endpoint attaches a chain of three Guards,
 * only the last answering DEEP, and whose Private Endpoint lists PURGED.
 */
function codeReachSnapshot() {
  const deep = defineRejection({ code: 'DEEP', status: 403, message: 'Deep' });
  const purged = defineRejection({ code: 'PURGED', status: 410, message: 'Purged' });
  const inner = defineGuard({ name: 'inner', description: 'Answers DEEP', rejections: [deep] });
  const middle = defineGuard({ name: 'middle', description: 'Builds on inner', guards: [inner] });
  const outer = defineGuard({ name: 'outer', description: 'Builds on middle', guards: [middle] });
  const getOrder = defineEndpoint({
    name: 'getOrder',
    method: 'GET',
    path: '/orders',
    visibility: 'public',
    description: 'Every order',
    guards: [inner, middle, outer],
    success: { status: 200, body: z.object({ count: z.int() }) },
  });
  const purgeOrders = defineEndpoint({
    name: 'purgeOrders',
    method: 'DELETE',
    path: '/orders',
    visibility: 'private',
    description: 'Every order gone',
    success: { status: 204 },
    rejections: [purged],
  });
  const group = defineGroup({
    name: 'orders',
    description: 'Orders',
    endpoints: [getOrder, purgeOrders],
  });
  const root = defineService({
    name: 'orders-service',
    standardRejections: orgDefinitions,
    groups: [group],
  });
  return serviceSnapshot(root);
}

/** A Service whose one Endpoint answers the Rejection, with no Definitions Package. */
function serviceRejecting(rejection: Rejection) {
  const getOrders = defineEndpoint({
    name: 'getOrders',
    method: 'GET',
    path: '/orders',
    visibility: 'public',
    description: 'Every order',
    success: { status: 200, body: z.object({ count: z.int() }) },
    rejections: [rejection],
  });
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrders] });
  return serviceSnapshot(defineService({ name: 'orders-service', groups: [group] }), []);
}

function textOf(snapshot: Snapshot): string {
  return canonicalTextOf(snapshot);
}

describe('snapshotOf: a Service', () => {
  test('the top level names the format, the kind and the Contract, and no CLI, version or Definitions Package', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot).toMatchObject({
      format: 1,
      kind: 'service',
      name: 'orders-service',
      events: {},
      commands: {},
      subscriptions: {},
    });
    expect(snapshot).not.toHaveProperty('generator');
    expect(snapshot).not.toHaveProperty('version');
  });

  test('groups holds each Group by name with its description', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.groups).toEqual({
      messages: { description: 'Messages' },
      orders: { description: 'Order lifecycle' },
    });
  });

  test('an Endpoint is written by its identity with its Group, Visibility, lifecycle, description and param names', () => {
    const snapshot = serviceSnapshot();

    expect(Object.keys(snapshot.endpoints)).toEqual([
      'GET /orders/{}',
      'PATCH /orders/{}/lines/{}',
    ]);
    expect(snapshot.endpoints['GET /orders/{}']).toMatchObject({
      name: 'getOrder',
      group: 'orders',
      visibility: 'public',
      lifecycle: 'active',
      description: 'One order by id',
      params: ['orderId'],
    });
    expect(snapshot.endpoints['PATCH /orders/{}/lines/{}']?.params).toEqual(['orderId', 'lineId']);
  });

  test('params hold exactly the path’s params', () => {
    const snapshot = serviceSnapshot();

    const params = snapshot.endpoints['PATCH /orders/{}/lines/{}']?.input.params;

    expect(params).toEqual({
      type: 'object',
      fields: {
        orderId: { required: true, schema: { type: 'string', format: 'uuid' } },
        lineId: { required: true, schema: { type: 'string', format: 'uuid' } },
      },
    });
  });

  test('the bodies an Endpoint does not declare are null, and the text parts have no field', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.endpoints['GET /orders/{}']?.input).toMatchObject({
      query: { type: 'object', fields: {} },
      body: null,
    });
    expect(snapshot.endpoints['GET /orders/{}']?.success.headers).toEqual({
      type: 'object',
      fields: {},
    });
    expect(snapshot.endpoints['PATCH /orders/{}/lines/{}']?.success).toMatchObject({
      status: 204,
      body: null,
    });
  });

  test('input headers are the Endpoint’s own plus every attached Guard’s demands', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.endpoints['GET /orders/{}']?.input.headers?.fields).toEqual({
      'x-trace': { required: false, schema: { type: 'string' } },
      'x-api-key': { required: true, schema: { type: 'string' } },
    });
  });

  test('a header declared twice is written with the first declaration’s annotations, and required when either requires it', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.endpoints['PATCH /orders/{}/lines/{}']?.input.headers?.fields).toEqual({
      authorization: {
        required: true,
        schema: { type: 'string', description: 'From the Endpoint' },
      },
    });
  });

  test('query params merge the Endpoint’s own with its Guards’ demands, open', () => {
    const query = searchQueryOf({
      own: z.object({ text: z.string() }),
      demanded: z.object({ tenant: z.string() }),
    });

    expect(query).toEqual({
      type: 'object',
      fields: {
        text: { required: true, schema: { type: 'string' } },
        tenant: { required: true, schema: { type: 'string' } },
      },
    });
  });

  test('Attachments keep their order, each with its Qualifier as written or null', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.endpoints['PATCH /orders/{}/lines/{}']?.guards).toEqual([
      { guard: 'userToken', qualifier: null },
      { guard: 'permission', qualifier: ['orders:read', 'orders:edit'] },
    ]);
  });

  test('an Endpoint’s rejections are its own, its Guards’ and the two the runtime adds, resolved and sorted by code', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.endpoints['GET /orders/{}']?.rejections).toEqual([
      'BAD_REQUEST',
      'NOT_FOUND',
      'NOT_IMPLEMENTED',
      'ORDER_LOCKED',
      'UNAUTHENTICATED',
    ]);
    expect(snapshot.endpoints['PATCH /orders/{}/lines/{}']?.rejections).toEqual([
      'BAD_REQUEST',
      'FORBIDDEN',
      'NOT_IMPLEMENTED',
      'UNAUTHENTICATED',
    ]);
  });

  test('only the Guards the Endpoints reach are written, each with its origin', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.guards).toEqual({
      apiKey: {
        origin: 'local',
        description: 'An API key per Caller',
        guards: [],
        qualifier: null,
        demands: {
          headers: {
            type: 'object',
            fields: { 'x-api-key': { required: true, schema: { type: 'string' } } },
          },
          query: { type: 'object', fields: {} },
        },
        context: {
          type: 'object',
          fields: { callerId: { required: true, schema: { type: 'string' } } },
        },
        rejections: ['UNAUTHENTICATED'],
      },
      userToken: expect.objectContaining({ origin: '@org/definitions@4.2.0', guards: [] }),
      permission: {
        origin: '@org/definitions@4.2.0',
        description: 'The user holds every listed permission',
        guards: ['userToken'],
        qualifier: {
          type: 'array',
          min: 1,
          items: { type: 'enum', values: ['orders:edit', 'orders:read'], open: false },
        },
        demands: { headers: { type: 'object', fields: {} }, query: { type: 'object', fields: {} } },
        context: null,
        rejections: ['FORBIDDEN'],
      },
    });
  });

  test('only the codes the Endpoints answer are written, with every Standard Rejection’s', () => {
    const snapshot = serviceSnapshot();

    expect(Object.keys(snapshot.codes).sort()).toEqual([
      'BAD_REQUEST',
      'FORBIDDEN',
      'NOT_FOUND',
      'NOT_IMPLEMENTED',
      'ORDER_LOCKED',
      'UNAUTHENTICATED',
    ]);
  });

  test.each([
    { reach: 'a Guard at the end of the attached chain answers', code: 'DEEP', written: true },
    { reach: 'only a Private Endpoint lists', code: 'PURGED', written: true },
    {
      reach: 'only an imported Definitions Package declares, and no Endpoint reaches',
      code: 'UNUSED',
      written: false,
    },
  ])('a code $reach is written: $written', ({ code, written }) => {
    const snapshot = codeReachSnapshot();

    expect(code in snapshot.codes).toBe(written);
  });

  test('a code carries its origin, status, message, headers and body, and is not removed', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.codes['ORDER_LOCKED']).toEqual({
      origin: 'local',
      status: 409,
      message: 'The order can no longer be changed',
      headers: { type: 'object', fields: {} },
      body: {
        type: 'object',
        fields: { lockedAt: { required: true, schema: { type: 'string', format: 'datetime' } } },
      },
    });
    expect(snapshot.codes['UNAUTHENTICATED']).toEqual({
      origin: '@org/definitions@4.2.0',
      status: 401,
      message: 'Unauthenticated',
      headers: {
        type: 'object',
        fields: {
          'www-authenticate': {
            required: true,
            schema: { type: 'string', description: 'The scheme to sign in with' },
          },
        },
      },
      body: null,
    });
  });

  test('the headers a Rejection declares are recorded under its code beside a body', () => {
    const rateLimited = defineRejection({
      code: 'RATE_LIMITED',
      status: 429,
      message: 'Slow down',
      headers: z.object({ 'retry-after': z.int(), 'x-limit': z.string().optional() }),
      body: z.object({ limit: z.int() }),
    });

    const snapshot = serviceRejecting(rateLimited);

    expect(snapshot.codes['RATE_LIMITED']).toMatchObject({
      headers: {
        type: 'object',
        fields: {
          'retry-after': { required: true, schema: { type: 'number', int: true } },
          'x-limit': { required: false, schema: { type: 'string' } },
        },
      },
      body: { type: 'object', fields: { limit: { required: true, schema: { type: 'number', int: true } } } },
    });
  });

  test('a code that declares no headers records an open object with no field, as a Standard Rejection’s does', () => {
    const snapshot = serviceRejecting(unusedRejection);

    expect(snapshot.codes['UNUSED']?.headers).toEqual({ type: 'object', fields: {} });
    expect(snapshot.codes['NOT_FOUND']?.headers).toEqual({ type: 'object', fields: {} });
    expect(snapshot.codes['NOT_IMPLEMENTED']?.headers).toEqual({ type: 'object', fields: {} });
    expect(snapshot.codes['INVALID_INPUT']?.headers).toEqual({ type: 'object', fields: {} });
  });

  test('standardRejections maps each Standard Rejection to the code it resolved to', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.standardRejections).toEqual({
      invalidInput: 'BAD_REQUEST',
      notFound: 'NOT_FOUND',
      notImplemented: 'NOT_IMPLEMENTED',
    });
  });

  test('each Standard Rejection’s status, message and origin are its code’s, under codes', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.codes['BAD_REQUEST']).toMatchObject({
      origin: '@org/definitions@4.2.0',
      status: 400,
      message: 'The request is invalid',
    });
    expect(snapshot.codes['NOT_FOUND']).toEqual({
      origin: 'standard',
      status: 404,
      message: 'Not found',
      headers: { type: 'object', fields: {} },
      body: null,
    });
    expect(snapshot.codes['NOT_IMPLEMENTED']).toMatchObject({
      origin: 'standard',
      status: 501,
      message: 'Not implemented',
    });
  });

  test('the invalid-input Rejection carries cf-loom’s body, its issues, with in and code as Open Enums', () => {
    const snapshot = serviceSnapshot();
    const issue = {
      type: 'object',
      fields: {
        in: {
          required: true,
          schema: { type: 'enum', values: ['body', 'headers', 'params', 'query'], open: true },
        },
        path: {
          required: true,
          schema: {
            type: 'array',
            items: { type: 'union', options: [{ type: 'string' }, { type: 'number' }] },
          },
        },
        code: {
          required: true,
          schema: {
            type: 'enum',
            values: [
              'invalid_format',
              'invalid_type',
              'invalid_value',
              'malformed',
              'not_multiple',
              'required',
              'too_big',
              'too_small',
              'unrecognized_key',
            ],
            open: true,
          },
        },
        message: { required: true, schema: { type: 'string' } },
      },
    };

    expect(snapshot.codes['BAD_REQUEST']?.body).toEqual({
      type: 'object',
      fields: { issues: { required: true, schema: { type: 'array', items: issue } } },
    });
  });

  test('a shared schema from a Definitions Package carries its origin with its name', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.endpoints['GET /orders/{}']?.success.body).toMatchObject({
      fields: { total: { schema: { origin: '@org/definitions@4.2.0#money' } } },
    });
  });

  test('Dependencies are written by Provider with against and Endpoints by id, sorted, and no Events', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.dependencies).toEqual({
      'payments-service': {
        against: '5.1.0',
        endpoints: [
          { id: 'GET /payments', name: 'listPayments' },
          { id: 'GET /payments/{}', name: 'getPayment' },
        ],
      },
    });
    expect(snapshot.subscriptions).toMatchObject({
      notifyOnFailed: { event: 'payments-service:PaymentFailed@1' },
      notifyOnSettled: { event: 'payments-service:PaymentSettled@1' },
    });
  });

  test('a Dependency is against the version of the installed package, whatever else its package exports', () => {
    const installed = anInstalledContract(payments, {
      packageName: '@org/contract-payments-service',
      version: '7.0.2',
    });

    const snapshot = serviceSnapshot(contract, [orgPackage], [installed]);

    expect(snapshot.dependencies['payments-service']?.against).toBe('7.0.2');
  });

  test('a Dependency is not against another installed package whose contract has the Provider’s name but Elements of its own', () => {
    const lookalike = anInstalledContract(
      {
        ...payments,
        endpoints: { getPayment: aGetPaymentOfItsOwn },
        events: {},
      },
      { packageName: '@org/payments-lookalike', version: '9.9.9' },
    );

    const snapshot = serviceSnapshot(contract, [orgPackage], [lookalike, paymentsPackage]);

    expect(snapshot.dependencies['payments-service']?.against).toBe('5.1.0');
  });

  test('a Dependency is against the package that exports the Provider’s Elements, not the one that re-exports them', () => {
    const original = anInstalledContract(payments, { version: '5.1.0' });
    const wrapper = anInstalledContract(payments, {
      packageName: '@org/payments-wrapper',
      version: '9.9.9',
      reaches: [original],
    });

    const snapshot = serviceSnapshot(contract, [orgPackage], [wrapper, original]);

    expect(snapshot.dependencies['payments-service']?.against).toBe('5.1.0');
  });

  test('recursive schemas are written once under defs and referenced', () => {
    type Category = { name: string; children: Category[] };
    const category: z.ZodType<Category> = z
      .object({
        name: z.string(),
        get children() {
          return z.array(category);
        },
      })
      .meta({ id: 'category' });
    const tree = defineEndpoint({
      name: 'tree',
      method: 'GET',
      path: '/tree',
      visibility: 'public',
      description: 'The tree',
      success: { status: 200, body: category },
    });
    const group = defineGroup({ name: 'tree', description: 'Tree', endpoints: [tree] });
    const root = defineService({ name: 'tree-service', groups: [group] });

    const snapshot = serviceSnapshot(root, []);

    expect(snapshot.endpoints['GET /tree']?.success.body).toEqual({
      type: 'ref',
      name: 'category',
    });
    expect(Object.keys(snapshot.defs)).toEqual(['category']);
  });
});

const orderBody = z.object({ orderId: z.uuid() });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  lifecycle: 'deprecated',
  body: orderBody,
});
const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'private',
  description: 'An order was placed, with its total',
  body: z.object({ orderId: z.uuid(), total: z.int() }),
});
const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: orderBody,
});

/** A Service that declares Messages and subscribes to its own Event and to a Dependency's. */
function messagingSnapshot(declared: {
  readonly events?: readonly [typeof orderCreatedV1 | typeof orderCreatedV2];
  readonly commands?: readonly [typeof chargeCardV1];
}) {
  const auditOrders = defineSubscription({
    name: 'auditOrders',
    description: 'Audits each order created',
    event: orderCreatedV2,
  });
  const root = defineService({
    name: 'orders-service',
    groups: [
      defineGroup({
        name: 'orders',
        description: 'Orders',
        events: declared.events ?? [orderCreatedV1, orderCreatedV2],
      }),
      defineGroup({
        name: 'payments',
        description: 'Payments',
        commands: declared.commands ?? [chargeCardV1],
        subscriptions: [auditOrders, notifyOnSettled, notifyOnFailed],
      }),
    ],
    dependencies: [paymentsDependency],
  });
  return serviceSnapshot(root, []);
}

const orderIdBody = {
  type: 'object',
  fields: { orderId: { required: true, schema: { type: 'string', format: 'uuid' } } },
};

describe('snapshotOf: one Snapshot for one Contract', () => {
  const emptyPart = { type: 'object', fields: {} };

  /** A one-Endpoint Service whose Endpoint declares the parts given and attaches a Guard that demands the part given. */
  function aPingService(parts: {
    readonly input?: { readonly query?: z.ZodObject; readonly headers?: z.ZodObject };
    readonly headers?: z.ZodObject;
    readonly demands?: { readonly query?: z.ZodObject; readonly headers?: z.ZodObject };
  }) {
    const gate = defineGuard({ name: 'gate', description: 'A gate', demands: parts.demands ?? {} });
    const ping = defineEndpoint({
      name: 'ping',
      method: 'GET',
      path: '/ping',
      visibility: 'public',
      description: 'Answers',
      guards: [gate],
      input: parts.input ?? {},
      success: {
        status: 200,
        body: z.object({ ok: z.boolean() }),
        ...(parts.headers === undefined ? {} : { headers: parts.headers }),
      },
    });
    const group = defineGroup({ name: 'health', description: 'Health', endpoints: [ping] });
    return defineService({ name: 'ping-service', groups: [group] });
  }

  test.each([
    ['an Endpoint’s query', { input: { query: z.object({}) } }],
    ['an Endpoint’s headers', { input: { headers: z.object({}) } }],
    ['a Success’s headers', { headers: z.object({}) }],
    ['a Guard’s demanded query', { demands: { query: z.object({}) } }],
    ['a Guard’s demanded headers', { demands: { headers: z.object({}) } }],
  ])(
    '%s declared with no field writes the same Snapshot as one not declared',
    (_name, declared) => {
      const empty = canonicalTextOf(snapshotFor(aPingService(declared), []));
      const undeclared = canonicalTextOf(snapshotFor(aPingService({}), []));

      expect(empty).toBe(undeclared);
    },
  );

  test('a text part with no field is an open object with no field, never null', () => {
    const snapshot = snapshotFor(aPingService({}), []);
    if (snapshot.kind !== 'service') {
      throw new Error('The fixture is no Service');
    }

    const endpoint = snapshot.endpoints['GET /ping'];
    expect([endpoint?.input.query, endpoint?.input.headers, endpoint?.success.headers]).toEqual([
      emptyPart,
      emptyPart,
      emptyPart,
    ]);
    expect(snapshot.guards['gate']?.demands).toEqual({ headers: emptyPart, query: emptyPart });
  });
});

/** A one-Endpoint Service whose Endpoint declares one query field and no headers. */
function aPingServiceWithQuery() {
  const ping = defineEndpoint({
    name: 'ping',
    method: 'GET',
    path: '/ping',
    visibility: 'public',
    description: 'Answers',
    input: { query: z.object({ page: z.string() }) },
    success: { status: 204 },
  });
  const group = defineGroup({ name: 'health', description: 'Health', endpoints: [ping] });
  return defineService({ name: 'ping-service', groups: [group] });
}

describe('isEmptyTextPart', () => {
  test('is the text part the Snapshot writes where none is declared, and no other', () => {
    const snapshot = snapshotFor(aPingServiceWithQuery(), []);
    if (snapshot.kind !== 'service') {
      throw new Error('The fixture is no Service');
    }
    const input = snapshot.endpoints['GET /ping']?.input;

    expect(input === undefined ? [] : [input.headers, input.query].map(isEmptyTextPart)).toEqual([
      true,
      false,
    ]);
  });

  test.each([
    ['a description', { type: 'object', fields: {}, description: 'The query' }],
    ['an example', { type: 'object', fields: {}, examples: [{}] }],
    ['an origin', { type: 'object', fields: {}, origin: '@org/definitions@1.0.0#query' }],
  ] as const)('is not a part that carries %s', (_name, part) => {
    expect(isEmptyTextPart(part)).toBe(false);
  });
});

describe('snapshotOf: Messages and Subscriptions', () => {
  test('Events are written by identity with their Group, Visibility, lifecycle, description and body', () => {
    const snapshot = messagingSnapshot({});

    expect(snapshot.events['OrderCreated@1']).toEqual({
      group: 'orders',
      visibility: 'internal',
      lifecycle: 'deprecated',
      description: 'An order was placed',
      body: orderIdBody,
    });
  });

  test('Commands are written by identity with their Group and no Visibility', () => {
    const snapshot = messagingSnapshot({});

    expect(snapshot.commands).toEqual({
      'ChargeCard@1': {
        group: 'payments',
        lifecycle: 'active',
        description: 'Charges the order’s card',
        body: orderIdBody,
      },
    });
  });

  test('a Message Version declared without a lifecycle is written active', () => {
    const snapshot = messagingSnapshot({});

    expect(snapshot.events['OrderCreated@2']?.lifecycle).toBe('active');
  });

  test('a Retired Message Version still declared keeps its full entry', () => {
    const retiredV1 = defineCommand({
      name: 'ChargeCard',
      version: 1,
      description: 'Charges the order’s card',
      lifecycle: 'retired',
      body: orderBody,
    });

    const snapshot = messagingSnapshot({ commands: [retiredV1] });

    expect(snapshot.commands['ChargeCard@1']).toEqual({
      group: 'payments',
      lifecycle: 'retired',
      description: 'Charges the order’s card',
      body: orderIdBody,
    });
  });

  test('a Subscription to the Service’s own Event writes the Service’s name before the Event’s identity', () => {
    const snapshot = messagingSnapshot({});

    expect(snapshot.subscriptions).toMatchObject({
      auditOrders: { event: 'orders-service:OrderCreated@2' },
    });
  });

  test('a Subscription to a Provider’s Event writes the Provider’s name before the Event’s identity', () => {
    const snapshot = messagingSnapshot({});

    expect(snapshot.subscriptions).toMatchObject({
      notifyOnSettled: { event: 'payments-service:PaymentSettled@1' },
    });
  });

  test('a Subscription writes its Group', () => {
    const snapshot = messagingSnapshot({});

    expect(snapshot.subscriptions).toMatchObject({ notifyOnSettled: { group: 'payments' } });
  });

  test('two Message Versions of one Command are written each with its own Group', () => {
    const chargeCardV2 = defineCommand({
      name: 'ChargeCard',
      version: 2,
      description: 'Charges the order’s card, again',
      lifecycle: 'deprecated',
      body: orderBody,
    });
    const root = defineService({
      name: 'orders-service',
      groups: [
        defineGroup({ name: 'orders', description: 'Orders', commands: [chargeCardV1] }),
        defineGroup({ name: 'payments', description: 'Payments', commands: [chargeCardV2] }),
      ],
    });

    const snapshot = serviceSnapshot(root, []);

    expect(snapshot.commands).toMatchObject({
      'ChargeCard@1': { group: 'orders' },
      'ChargeCard@2': { group: 'payments' },
    });
  });

  test('a Subscription writes its description', () => {
    const snapshot = messagingSnapshot({});

    expect(snapshot.subscriptions).toMatchObject({
      notifyOnSettled: { description: 'Notifies the customer of each payment settled' },
    });
  });

  test('two Subscriptions whose names differ only in the case of a letter get two keys', () => {
    const settle2xy = defineSubscription({
      name: 'settle2xy',
      description: 'Settles lower',
      event: orderCreatedV2,
    });
    const settle2Xy = defineSubscription({
      name: 'settle2Xy',
      description: 'Settles upper',
      event: orderCreatedV2,
    });
    const root = defineService({
      name: 'orders-service',
      groups: [
        defineGroup({
          name: 'messages',
          description: 'Messages',
          events: [orderCreatedV2],
          subscriptions: [settle2xy, settle2Xy],
        }),
      ],
    });

    const snapshot = serviceSnapshot(root, []);

    expect(Object.keys(snapshot.subscriptions).toSorted()).toEqual(['settle2Xy', 'settle2xy']);
  });

  test('Message Versions are keyed in code point order in the canonical text', () => {
    const orderCreatedV10 = defineEvent({
      name: 'OrderCreated',
      version: 10,
      visibility: 'internal',
      description: 'An order was placed',
      body: orderBody,
    });
    const root = defineService({
      name: 'orders-service',
      groups: [
        defineGroup({
          name: 'messages',
          description: 'Messages',
          events: [orderCreatedV2, orderCreatedV10],
        }),
      ],
    });

    const text = textOf(serviceSnapshot(root, []));

    expect(text.indexOf('"OrderCreated@10"')).toBeLessThan(text.indexOf('"OrderCreated@2"'));
  });
});

describe('snapshotOf: deprecatedAt', () => {
  test('a Deprecated Endpoint carries the deprecatedAt its declaration states', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.endpoints['PATCH /orders/{}/lines/{}']?.deprecatedAt).toBe(deprecatedAt);
  });

  test('a future deprecatedAt is carried as declared', () => {
    const scheduled = defineEndpoint({
      name: 'scheduled',
      method: 'GET',
      path: '/scheduled',
      visibility: 'public',
      description: 'Deprecated as of a day to come',
      lifecycle: 'deprecated',
      deprecatedAt: '2999-01-01T00:00:00Z',
      success: { status: 204 },
    });
    const root = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [scheduled] })],
    });

    const snapshot = serviceSnapshot(root, []);

    expect(snapshot.endpoints['GET /scheduled']?.deprecatedAt).toBe('2999-01-01T00:00:00Z');
  });

  test('an Active Endpoint carries no deprecatedAt', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.endpoints['GET /orders/{}']).not.toHaveProperty('deprecatedAt');
  });
});

describe('snapshotOf: an Application', () => {
  test('an Application’s Snapshot holds only its Dependencies', () => {
    const adminDependency = defineDependency({
      provider: payments,
      endpoints: [payments.endpoints.getPayment],
    });
    const application = defineApplication({ name: 'web-admin', dependencies: [adminDependency] });

    const snapshot = snapshotFor(application, []);

    expect(snapshot).toEqual({
      format: 1,
      kind: 'application',
      name: 'web-admin',
      dependencies: {
        'payments-service': {
          against: '5.1.0',
          endpoints: [{ id: 'GET /payments/{}', name: 'getPayment' }],
        },
      },
    });
  });
});

describe('snapshotOf: a Definitions Package', () => {
  test('a Definitions Package’s Snapshot writes every Guard, shared schema and code it declares, as local', () => {
    const snapshot = snapshotFor(orgDefinitions, []);

    expect(snapshot).toMatchObject({
      format: 1,
      kind: 'definitions',
      name: '@org/definitions',
      defs: {},
      exports: {
        forbidden: { kind: 'rejection', code: 'FORBIDDEN' },
        money: {
          kind: 'schema',
          schema: {
            type: 'object',
            fields: {
              amount: { required: true, schema: { type: 'number', int: true } },
              currency: { required: true, schema: { type: 'string' } },
            },
          },
        },
        permission: { kind: 'guard', guard: 'permission' },
        unauthenticated: { kind: 'rejection', code: 'UNAUTHENTICATED' },
        unusedGuard: { kind: 'guard', guard: 'unusedGuard' },
        unusedRejection: { kind: 'rejection', code: 'UNUSED' },
        userToken: { kind: 'guard', guard: 'userToken' },
      },
    });
    expect(snapshot.kind === 'definitions' && Object.keys(snapshot.guards).sort()).toEqual([
      'permission',
      'unusedGuard',
      'userToken',
    ]);
    expect(snapshot.kind === 'definitions' && snapshot.codes['UNUSED']?.origin).toBe('local');
    expect(snapshot.kind === 'definitions' && snapshot.codes['BAD_REQUEST']?.origin).toBe('local');
    expect(snapshot).not.toHaveProperty('endpoints');
    expect(snapshot).not.toHaveProperty('definitions');
  });

  test('a Definitions Package’s standardRejections maps each Standard Rejection to its code', () => {
    const snapshot = snapshotFor(orgDefinitions, []);

    expect(snapshot.kind === 'definitions' && snapshot.standardRejections).toEqual({
      invalidInput: 'BAD_REQUEST',
      notFound: 'NOT_FOUND',
      notImplemented: 'NOT_IMPLEMENTED',
    });
  });
});

describe('the kind of a Root', () => {
  test('a Root’s declared Snapshot has the kind its declaration has, for every kind of Root', () => {
    const roots = [
      defineService({ name: 'orders-service' }),
      defineApplication({ name: 'web-admin' }),
      defineDefinitions({}),
    ] satisfies readonly Root[];

    const kinds = roots.map((root) => snapshotFor(root, []).kind);

    expect(kinds).toEqual(['service', 'application', 'definitions']);
    expect(kinds).toEqual(roots.map((root) => root.kind));
  });

  test('the kind of a Root is the kind of its Snapshot', () => {
    const service = defineService({ name: 'orders-service' });

    const kind: RootKind = snapshotFor(service, []).kind;

    expectTypeOf<RootKind>().toEqualTypeOf<Snapshot['kind']>();
    expect(kind).toBe(service.kind);
  });
});

describe('canonicalTextOf', () => {
  test('the heading comes first, then keys by code point, indented by two spaces, with a final newline', () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [] });

    const text = textOf(snapshotFor(application, []));

    expect(text).toBe(
      [
        '{',
        '  "format": 1,',
        '  "kind": "application",',
        '  "name": "web-admin",',
        '  "dependencies": {}',
        '}',
        '',
      ].join('\n'),
    );
  });

  test('a published Snapshot’s heading runs format, kind, name, version, generator', () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [] });
    const declared = snapshotFor(application, []);
    const heading = { version: '3.4.0', generator: '@cf-loom/cli@2.1.0' };

    const published = publishedSnapshotOf(undefined, declared, heading);

    expect(canonicalTextOf(published).split('\n').slice(0, 7)).toEqual([
      '{',
      '  "format": 1,',
      '  "kind": "application",',
      '  "name": "web-admin",',
      '  "version": "3.4.0",',
      '  "generator": "@cf-loom/cli@2.1.0",',
      '  "dependencies": {}',
    ]);
  });

  test('a published Definitions Package’s heading runs format, kind, name, version, generator', () => {
    const declared = snapshotFor(orgDefinitions, []);
    const heading = { version: '4.2.0', generator: '@cf-loom/cli@2.1.0' };

    const published = publishedSnapshotOf(undefined, declared, heading);

    expect(canonicalTextOf(published).split('\n').slice(1, 6)).toEqual([
      '  "format": 1,',
      '  "kind": "definitions",',
      '  "name": "@org/definitions",',
      '  "version": "4.2.0",',
      '  "generator": "@cf-loom/cli@2.1.0",',
    ]);
  });

  test('a nested object that holds a heading key keeps its keys sorted by code point', () => {
    const written = JSON.parse(textOf(serviceSnapshot()));

    const endpointKeys = Object.keys(written.endpoints['GET /orders/{}']);

    expect(Object.keys(written).slice(0, 3)).toEqual(['format', 'kind', 'name']);
    expect(endpointKeys).toContain('name');
    expect(endpointKeys).toEqual([...endpointKeys].sort());
  });

  test('the same Contract written in another order gives the same bytes', () => {
    const reordered = defineService({
      name: 'orders-service',
      standardRejections: orgDefinitions,
      groups: [
        defineGroup({
          name: 'orders',
          description: 'Order lifecycle',
          endpoints: [editOrder, aGetOrder([notFound, orderLocked])],
        }),
        defineGroup({
          name: 'messages',
          description: 'Messages',
          subscriptions: [notifyOnFailed, notifyOnSettled],
        }),
      ],
      dependencies: [
        defineDependency({
          provider: payments,
          endpoints: [payments.endpoints.listPayments, payments.endpoints.getPayment],
        }),
      ],
    });

    const written = textOf(snapshotFor(contract));
    const rewritten = textOf(snapshotFor(reordered));

    expect(rewritten).toBe(written);
  });

  test('a key that looks like an index is still sorted by code point', () => {
    const variants = z.discriminatedUnion('code', [
      z.object({ code: z.literal(1) }),
      z.object({ code: z.literal('a') }),
    ]);
    const tagged = defineEndpoint({
      name: 'tagged',
      method: 'GET',
      path: '/tagged',
      visibility: 'public',
      description: 'Tagged',
      success: { status: 200, body: variants },
    });
    const group = defineGroup({ name: 'tagged', description: 'Tagged', endpoints: [tagged] });
    const root = defineService({ name: 'tagged-service', groups: [group] });

    const text = textOf(snapshotFor(root, []));

    expect(text.indexOf('"\\"a\\"": {')).toBeLessThan(text.indexOf('"1": {'));
  });
});

describe('originPackagesOf', () => {
  test('a Contract that takes its Guards, codes and schemas from a Definitions Package names that package at its version', () => {
    const snapshot = serviceSnapshot();

    const packages = originPackagesOf(snapshot);

    expect(packages).toEqual([{ packageName: '@org/definitions', version: '4.2.0' }]);
  });

  test('a Contract that takes nothing from a Definitions Package names none', () => {
    const own = defineService({ name: 'orders-service' });

    const packages = originPackagesOf(snapshotFor(own, []));

    expect(packages).toEqual([]);
  });

  test('a Definitions Package’s own Snapshot, whose origins are local, names none', () => {
    const packages = originPackagesOf(snapshotFor(orgDefinitions, []));

    expect(packages).toEqual([]);
  });

  test('an Application names none', () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [] });

    const packages = originPackagesOf(snapshotFor(application, []));

    expect(packages).toEqual([]);
  });

  test('each package version is named once, by package then version, wherever its origin sits', () => {
    const snapshot = structuredClone(serviceSnapshot());
    const guards = Object.values(snapshot.guards);
    const codes = Object.values(snapshot.codes);
    Object.assign(guards[0] ?? {}, { origin: '@other/auth@1.0.0' });
    Object.assign(codes[0] ?? {}, { origin: '@org/definitions@3.9.0' });

    const packages = originPackagesOf(snapshot);

    expect(packages).toEqual([
      { packageName: '@org/definitions', version: '3.9.0' },
      { packageName: '@org/definitions', version: '4.2.0' },
      { packageName: '@other/auth', version: '1.0.0' },
    ]);
  });

  const onlyHere = '@org/only-here@1.2.3#shape';

  const messages = defineGroup({
    name: 'messages',
    description: 'Messages',
    events: [
      defineEvent({
        name: 'OrderPlaced',
        version: 1,
        visibility: 'internal',
        description: 'An order was placed',
        body: z.object({ orderId: z.string() }),
      }),
    ],
    commands: [
      defineCommand({
        name: 'ChargeCard',
        version: 1,
        description: 'Charges the card',
        body: z.object({ orderId: z.string() }),
      }),
    ],
  });

  /** A Snapshot whose origins are all `local`, so a test puts one origin in the place it tests. */
  function withoutOrigins(snapshot: Snapshot): Snapshot {
    const text = JSON.stringify(snapshot);
    return JSON.parse(text, (key, value) => (key === 'origin' ? 'local' : value));
  }

  /** The Snapshot with `origin` on what sits at the path. */
  function withOriginAt(snapshot: Snapshot, path: readonly string[], origin: string): Snapshot {
    const copy = structuredClone(snapshot);
    let place: unknown = copy;
    for (const step of path) {
      place = Reflect.get(Object(place), step);
    }
    Object.assign(Object(place), { origin });
    return copy;
  }

  const service = () => withoutOrigins(serviceSnapshot());
  const withMessages = () =>
    withoutOrigins(snapshotFor(defineService({ name: 'orders-service', groups: [messages] }), []));
  const definitions = () => withoutOrigins(snapshotFor(orgDefinitions, []));

  test.each([
    {
      place: 'an Endpoint’s Input',
      snapshot: service,
      at: ['endpoints', 'GET /orders/{}', 'input', 'headers'],
    },
    {
      place: 'an Endpoint’s Success',
      snapshot: service,
      at: ['endpoints', 'GET /orders/{}', 'success', 'body'],
    },
    { place: 'an Event’s body', snapshot: withMessages, at: ['events', 'OrderPlaced@1', 'body'] },
    { place: 'a Command’s body', snapshot: withMessages, at: ['commands', 'ChargeCard@1', 'body'] },
    { place: 'a Guard’s schema', snapshot: service, at: ['guards', 'userToken', 'context'] },
    { place: 'a code’s body', snapshot: service, at: ['codes', 'ORDER_LOCKED', 'body'] },
    { place: 'a Guard', snapshot: service, at: ['guards', 'userToken'] },
    { place: 'a code', snapshot: service, at: ['codes', 'ORDER_LOCKED'] },
    {
      place: 'a Definitions Package’s shared schema',
      snapshot: definitions,
      at: ['exports', 'money', 'schema'],
    },
  ])('an origin only on $place is read', ({ snapshot, at }) => {
    const edited = withOriginAt(snapshot(), at, onlyHere);

    const packages = originPackagesOf(edited);

    expect(packages).toEqual([{ packageName: '@org/only-here', version: '1.2.3' }]);
  });

  test('origins that are all local, or the standard ones, name no package', () => {
    const packages = originPackagesOf(service());

    expect(packages).toEqual([]);
  });

  test('the origin of a schema in a def is read too, whatever it follows', () => {
    const snapshot = {
      ...serviceSnapshot(),
      defs: { shared: { type: 'string', origin: '@org/shapes@2.0.0#shared' } },
    } as const;

    const packages = originPackagesOf(snapshot);

    expect(packages).toContainEqual({ packageName: '@org/shapes', version: '2.0.0' });
  });
});
