import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type ContractPackage,
  defineApplication,
  defineCommand,
  defineContract,
  defineDefinitions,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineSubscription,
  notFound,
} from '../index.ts';
import {
  canonicalTextOf,
  type ResolvedDefinitions,
  type Snapshot,
  type SnapshotContext,
  schemaOriginsOf,
  snapshotOf,
  validateContract,
} from '../internal/index.ts';

const money = z.object({ amount: z.int(), currency: z.string() });

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
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
  name: 'definitions',
  guards: [userToken, permission, unusedGuard],
  schemas: { money },
  rejections: [unauthenticated, forbidden, unusedRejection],
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

const editOrder = defineEndpoint({
  name: 'editOrder',
  method: 'PATCH',
  path: '/orders/:orderId/lines/:lineId',
  visibility: 'internal',
  description: 'Edits one line',
  lifecycle: 'deprecated',
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

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'public',
  description: 'One payment by id',
  input: { params: z.object({ paymentId: z.uuid() }) },
  success: { status: 200, body: z.object({ amount: z.int() }) },
});
const listPayments = defineEndpoint({
  name: 'listPayments',
  method: 'GET',
  path: '/payments',
  visibility: 'public',
  description: 'Every payment',
  success: { status: 200, body: z.object({ count: z.int() }) },
});

const paymentSettledV1 = defineEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});
const paymentFailedV1 = defineEvent({
  name: 'PaymentFailed',
  version: 1,
  visibility: 'internal',
  description: 'A payment failed',
  body: z.object({ paymentId: z.uuid() }),
});

const payments = {
  name: 'payments-service',
  version: '5.1.0',
  endpoints: { getPayment, listPayments },
  events: { paymentSettledV1, paymentFailedV1 },
  standardRejections: {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

const paymentsDependency = defineDependency({
  provider: payments,
  endpoints: [payments.endpoints.getPayment, payments.endpoints.listPayments],
});

const orgPackage: ResolvedDefinitions = {
  definitions: orgDefinitions,
  packageName: '@org/definitions',
  version: '4.2.0',
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

const contract = defineContract({
  name: 'orders-service',
  definitions: [orgDefinitions],
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

const stampedAt = '2026-10-17T09:30:00Z';

function aContext(overrides: Partial<SnapshotContext> = {}): SnapshotContext {
  return {
    generator: '@cf-loom/cli@2.1.0',
    packages: [orgPackage],
    committed: undefined,
    now: Date.parse('2026-10-18T12:00:00.750Z'),
    ...overrides,
  };
}

function snapshotFor(root: unknown, context: SnapshotContext = aContext()): Snapshot {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  const originOf = schemaOriginsOf(context.packages);
  const packageName = String(name);
  const validated = validateContract(root, { originOf, packageName, exportsOf: () => [] });
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  return snapshotOf(validated, context);
}

function serviceSnapshot(root: unknown = contract, context: SnapshotContext = aContext()) {
  const snapshot = snapshotFor(root, context);
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
  const root = defineContract({ name: 'search-service', groups: [group] });
  return serviceSnapshot(root, aContext({ packages: [] })).endpoints['GET /search']?.input.query;
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
  const root = defineContract({
    name: 'orders-service',
    definitions: [orgDefinitions],
    groups: [group],
  });
  return serviceSnapshot(root);
}

function textOf(snapshot: Snapshot): string {
  return canonicalTextOf(snapshot);
}

describe('snapshotOf: a Service', () => {
  test('the top level names the format, the kind, the Contract, the generator and the Definitions Packages at their versions', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot).toMatchObject({
      format: 1,
      kind: 'service',
      name: 'orders-service',
      generator: '@cf-loom/cli@2.1.0',
      definitions: { '@org/definitions': '4.2.0' },
      events: {},
      commands: {},
      subscriptions: {},
    });
    expect(snapshot).not.toHaveProperty('version');
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

  test('params hold exactly the path’s params, like any object with no mode', () => {
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

  test('the parts an Endpoint does not declare are null', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.endpoints['GET /orders/{}']?.input).toMatchObject({ query: null, body: null });
    expect(snapshot.endpoints['GET /orders/{}']?.success.headers).toBeNull();
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
          query: null,
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
        demands: { headers: null, query: null },
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
      reach: 'only a listed Definitions Package declares, and no Endpoint reaches',
      code: 'UNUSED',
      written: false,
    },
  ])('a code $reach is written: $written', ({ code, written }) => {
    const snapshot = codeReachSnapshot();

    expect(code in snapshot.codes).toBe(written);
  });

  test('a code carries its origin, status, message and body, and is not removed', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.codes['ORDER_LOCKED']).toEqual({
      origin: 'local',
      status: 409,
      message: 'The order can no longer be changed',
      body: {
        type: 'object',
        fields: { lockedAt: { required: true, schema: { type: 'string', format: 'datetime' } } },
      },
      removed: false,
    });
    expect(snapshot.codes['UNAUTHENTICATED']).toEqual({
      origin: '@org/definitions@4.2.0',
      status: 401,
      message: 'Unauthenticated',
      body: null,
      removed: false,
    });
  });

  test('a code declared twice is written with the first declaration’s message, a Definitions Package’s before an Endpoint’s', () => {
    const lockedAgain = defineRejection({
      code: 'UNAUTHENTICATED',
      status: 401,
      message: 'Declared again',
    });
    const ping = defineEndpoint({
      name: 'ping',
      method: 'GET',
      path: '/ping',
      visibility: 'public',
      description: 'Ping',
      success: { status: 200, body: z.object({ ok: z.boolean() }) },
      rejections: [lockedAgain],
    });
    const group = defineGroup({ name: 'ping', description: 'Ping', endpoints: [ping] });
    const root = defineContract({
      name: 'ping-service',
      definitions: [orgDefinitions],
      groups: [group],
    });

    const snapshot = serviceSnapshot(root);

    expect(snapshot.codes['UNAUTHENTICATED']?.message).toBe('Unauthenticated');
  });

  test('Standard Rejections are resolved with their origin: the Definitions Package’s, else cf-loom’s', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.standardRejections).toEqual({
      invalidInput: {
        origin: '@org/definitions@4.2.0',
        code: 'BAD_REQUEST',
        status: 400,
        message: 'The request is invalid',
        body: expect.objectContaining({ type: 'object' }),
      },
      notFound: { origin: 'standard', code: 'NOT_FOUND', status: 404, message: 'Not found' },
      notImplemented: {
        origin: 'standard',
        code: 'NOT_IMPLEMENTED',
        status: 501,
        message: 'Not implemented',
      },
    });
    expect(snapshot.codes['NOT_FOUND']).toEqual({
      origin: 'standard',
      status: 404,
      message: 'Not found',
      body: null,
      removed: false,
    });
  });

  test('the invalid-input Rejection carries cf-loom’s body, its issues', () => {
    const snapshot = serviceSnapshot();
    const issue = {
      type: 'object',
      fields: {
        in: {
          required: true,
          schema: { type: 'enum', values: ['body', 'headers', 'params', 'query'], open: false },
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
            open: false,
          },
        },
        message: { required: true, schema: { type: 'string' } },
      },
    };

    expect(snapshot.standardRejections.invalidInput.body).toEqual({
      type: 'object',
      fields: { issues: { required: true, schema: { type: 'array', items: issue } } },
    });
    expect(snapshot.codes['BAD_REQUEST']?.body).toEqual(
      snapshot.standardRejections.invalidInput.body,
    );
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

  test('recursive schemas are written once under defs and referenced', () => {
    type Category = { name: string; children: Category[] };
    const category: z.ZodType<Category> = z
      .object({
        name: z.string(),
        get children() {
          return z.array(category);
        },
      })
      .meta({ id: 'Category' });
    const tree = defineEndpoint({
      name: 'tree',
      method: 'GET',
      path: '/tree',
      visibility: 'public',
      description: 'The tree',
      success: { status: 200, body: category },
    });
    const group = defineGroup({ name: 'tree', description: 'Tree', endpoints: [tree] });
    const root = defineContract({ name: 'tree-service', groups: [group] });

    const snapshot = serviceSnapshot(root, aContext({ packages: [] }));

    expect(snapshot.endpoints['GET /tree']?.success.body).toEqual({
      type: 'ref',
      name: 'Category',
    });
    expect(Object.keys(snapshot.defs)).toEqual(['Category']);
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
  const root = defineContract({
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
  return serviceSnapshot(root, aContext({ packages: [] }));
}

const orderIdBody = {
  type: 'object',
  fields: { orderId: { required: true, schema: { type: 'string', format: 'uuid' } } },
};

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
    const root = defineContract({
      name: 'orders-service',
      groups: [
        defineGroup({ name: 'orders', description: 'Orders', commands: [chargeCardV1] }),
        defineGroup({ name: 'payments', description: 'Payments', commands: [chargeCardV2] }),
      ],
    });

    const snapshot = serviceSnapshot(root, aContext({ packages: [] }));

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
    const settle2x = defineSubscription({
      name: 'settle2x',
      description: 'Settles lower',
      event: orderCreatedV2,
    });
    const settle2X = defineSubscription({
      name: 'settle2X',
      description: 'Settles upper',
      event: orderCreatedV2,
    });
    const root = defineContract({
      name: 'orders-service',
      groups: [
        defineGroup({
          name: 'messages',
          description: 'Messages',
          events: [orderCreatedV2],
          subscriptions: [settle2x, settle2X],
        }),
      ],
    });

    const snapshot = serviceSnapshot(root, aContext({ packages: [] }));

    expect(Object.keys(snapshot.subscriptions).toSorted()).toEqual(['settle2X', 'settle2x']);
  });

  test('Message Versions are keyed in code point order in the canonical text', () => {
    const orderCreatedV10 = defineEvent({
      name: 'OrderCreated',
      version: 10,
      visibility: 'internal',
      description: 'An order was placed',
      body: orderBody,
    });
    const root = defineContract({
      name: 'orders-service',
      groups: [
        defineGroup({
          name: 'messages',
          description: 'Messages',
          events: [orderCreatedV2, orderCreatedV10],
        }),
      ],
    });

    const text = textOf(serviceSnapshot(root, aContext({ packages: [] })));

    expect(text.indexOf('"OrderCreated@10"')).toBeLessThan(text.indexOf('"OrderCreated@2"'));
  });
});

describe('snapshotOf: deprecatedAt', () => {
  test('a Deprecated Endpoint keeps the deprecatedAt of the committed Snapshot', () => {
    const committed = {
      endpoints: { 'PATCH /orders/{}/lines/{}': { deprecatedAt: stampedAt } },
    };

    const snapshot = serviceSnapshot(contract, aContext({ committed }));

    expect(snapshot.endpoints['PATCH /orders/{}/lines/{}']?.deprecatedAt).toBe(stampedAt);
  });

  test('an Endpoint first seen Deprecated is stamped with the clock, to the second', () => {
    const snapshot = serviceSnapshot();

    expect(snapshot.endpoints['PATCH /orders/{}/lines/{}']?.deprecatedAt).toBe(
      '2026-10-18T12:00:00Z',
    );
  });

  test.each([
    '2026-10-17T09:30:00.000Z',
    '2026-10-17T09:30:00+00:00',
    '2026-02-30T09:30:00Z',
    'yesterday',
    1760693400,
  ])(
    'a committed deprecatedAt that is no UTC instant to the second, %s, is stamped again',
    (stamp) => {
      const committed = { endpoints: { 'PATCH /orders/{}/lines/{}': { deprecatedAt: stamp } } };

      const snapshot = serviceSnapshot(contract, aContext({ committed }));

      expect(snapshot.endpoints['PATCH /orders/{}/lines/{}']?.deprecatedAt).toBe(
        '2026-10-18T12:00:00Z',
      );
    },
  );

  test('an Active Endpoint carries no deprecatedAt, whatever the committed Snapshot says', () => {
    const committed = { endpoints: { 'GET /orders/{}': { deprecatedAt: stampedAt } } };

    const snapshot = serviceSnapshot(contract, aContext({ committed }));

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

    const snapshot = snapshotFor(application, aContext({ packages: [] }));

    expect(snapshot).toEqual({
      format: 1,
      kind: 'application',
      name: 'web-admin',
      generator: '@cf-loom/cli@2.1.0',
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
    const snapshot = snapshotFor(orgDefinitions, aContext({ packages: [] }));

    expect(snapshot).toMatchObject({
      format: 1,
      kind: 'definitions',
      name: 'definitions',
      generator: '@cf-loom/cli@2.1.0',
      defs: {},
      schemas: {
        money: {
          type: 'object',
          fields: {
            amount: { required: true, schema: { type: 'number', int: true } },
            currency: { required: true, schema: { type: 'string' } },
          },
        },
      },
    });
    expect(snapshot.kind === 'definitions' && Object.keys(snapshot.guards).sort()).toEqual([
      'permission',
      'unusedGuard',
      'userToken',
    ]);
    expect(snapshot.kind === 'definitions' && snapshot.codes['UNUSED']?.origin).toBe('local');
    expect(snapshot.kind === 'definitions' && snapshot.standardRejections.invalidInput.origin).toBe(
      'local',
    );
    expect(snapshot).not.toHaveProperty('endpoints');
    expect(snapshot).not.toHaveProperty('definitions');
  });
});

describe('canonicalTextOf', () => {
  test('keys are sorted by code point, indented by two spaces, with a final newline', () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [] });

    const text = textOf(snapshotFor(application, aContext({ packages: [] })));

    expect(text).toBe(
      [
        '{',
        '  "dependencies": {},',
        '  "format": 1,',
        '  "generator": "@cf-loom/cli@2.1.0",',
        '  "kind": "application",',
        '  "name": "web-admin"',
        '}',
        '',
      ].join('\n'),
    );
  });

  test('the same Contract written in another order gives the same bytes', () => {
    const reordered = defineContract({
      name: 'orders-service',
      definitions: [orgDefinitions],
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
    const root = defineContract({ name: 'tagged-service', groups: [group] });

    const text = textOf(snapshotFor(root, aContext({ packages: [] })));

    expect(text.indexOf('"\\"a\\"": {')).toBeLessThan(text.indexOf('"1": {'));
  });
});
