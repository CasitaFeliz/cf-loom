import * as built from '@cf-loom/contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import { summarized } from '../../test/failures.ts';
import { anInstalledPackage, aRootPackage } from '../../test/root-package.ts';
import {
  type ContractPackage,
  defineApplication,
  defineDefinitions,
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Guard,
  notFound,
  openEnum,
  providedEndpoint,
} from '../index.ts';
import { type Root, type Site, validateRoot, walkSchemas } from '../internal/index.ts';

/** Validates a Root as the package it names: its package.json named as the Root is. */
function validateInPackage(root: Root) {
  return summarized(validateRoot(root, aRootPackage(root)));
}

/** Where the walker is asked to walk a schema here: a site of its own, named, with no steps. */
function aPlace(name: string) {
  return { site: { kind: 'export', name }, declaration: undefined, steps: [] } as const;
}

/** Where a declaration sits: at its site, with the declaration itself and no steps. */
function sitting(site: Site, declaration: unknown) {
  return { site, declaration, steps: [] };
}

function noOrigin() {
  return undefined;
}

/** A walked location's node, so a test compares with the walker itself. */
function walkedNodeOf({ walked }: ReturnType<typeof walkSchemas>['located'][number]) {
  return walked.kind === 'walked' ? walked.value : undefined;
}

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
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

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  guards: [apiKey],
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 200, body: z.object({ id: z.uuid() }) },
  rejections: [notFound, orderLocked],
});

const ordersGroup = defineGroup({
  name: 'orders',
  description: 'Order lifecycle',
  endpoints: [getOrder],
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

const payments = {
  name: 'payments-service',
  endpoints: { getPayment },
  events: {},
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

describe('validateRoot', () => {
  test('a valid Contract finds the walked node of each declaration’s part', () => {
    const contract = defineService({ name: 'orders-service', groups: [ordersGroup] });
    const located = [
      { at: aPlace('params'), schema: getOrder.input.params },
      { at: aPlace('body'), schema: getOrder.success.body },
      { at: aPlace('headers'), schema: apiKey.demands.headers },
      { at: aPlace('context'), schema: apiKey.context },
      { at: aPlace('lockedBody'), schema: orderLocked.body },
    ];
    const walked = walkSchemas(located, noOrigin);

    const validated = validateInPackage(contract);

    const { nodeOf, defs } = validated.kind === 'valid' ? validated.schemas : unreachable();
    expect([
      nodeOf(getOrder, 'input.params'),
      nodeOf(getOrder, 'success.body'),
      nodeOf(apiKey, 'demands.headers'),
      nodeOf(apiKey, 'context'),
      nodeOf(orderLocked, 'body'),
    ]).toEqual(walked.located.map(walkedNodeOf));
    expect(defs).toEqual({});
  });

  test('a valid Contract carries what it reaches in the Root’s order: Endpoints by identity, Guards and codes, Standard Rejections resolved', () => {
    const shared = defineGuard({
      name: 'shared',
      description: 'Exported, attached by no Endpoint',
    });
    const unused = defineRejection({ code: 'UNUSED', status: 410, message: 'Unused' });
    const definitions = defineDefinitions({
      standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Missing' } },
    });
    const contract = defineService({
      name: 'orders-service',
      standardRejections: definitions,
      groups: [ordersGroup],
    });
    const installed = anInstalledPackage(definitions, { shared, unused, apiKey });

    const validated = validateRoot(contract, aRootPackage(contract, { packages: [installed] }));

    expect(validated.kind === 'valid' && validated.declarations).toEqual({
      root: contract,
      packageName: 'orders-service',
      ownMembers: undefined,
      groups: [{ at: sitting({ kind: 'group', name: 'orders' }, ordersGroup), group: ordersGroup }],
      endpoints: [
        {
          at: sitting({ kind: 'endpoint', identity: 'GET /orders/{}', name: 'getOrder' }, getOrder),
          endpoint: getOrder,
          group: ordersGroup,
        },
      ],
      guards: [
        { at: sitting({ kind: 'guard', name: 'apiKey' }, apiKey), guard: apiKey, from: installed },
      ],
      codes: [
        {
          code: 'UNAUTHENTICATED',
          at: sitting({ kind: 'code', code: 'UNAUTHENTICATED' }, unauthenticated),
          rejection: unauthenticated,
          from: undefined,
        },
        {
          code: 'ORDER_LOCKED',
          at: sitting({ kind: 'code', code: 'ORDER_LOCKED' }, orderLocked),
          rejection: orderLocked,
          from: undefined,
        },
      ],
      standardRejections: [
        {
          name: 'invalidInput',
          at: sitting({ kind: 'standard-rejection', name: 'invalidInput' }, definitions),
          code: 'INVALID_INPUT',
          status: 400,
          message: 'Invalid input',
          declared: undefined,
        },
        {
          name: 'notFound',
          at: sitting({ kind: 'standard-rejection', name: 'notFound' }, definitions),
          code: 'MISSING',
          status: 404,
          message: 'Missing',
          declared: {
            at: sitting({ kind: 'standard-rejection', name: 'notFound' }, definitions),
            name: 'notFound',
            declaration: { code: 'MISSING', status: 404, message: 'Missing' },
          },
        },
        {
          name: 'notImplemented',
          at: sitting({ kind: 'standard-rejection', name: 'notImplemented' }, definitions),
          code: 'NOT_IMPLEMENTED',
          status: 501,
          message: 'Not implemented',
          declared: undefined,
        },
      ],
      standardRejectionsSource: installed,
      dependencies: [],
      events: [],
      commands: [],
      subscriptions: [],
    });
  });

  test('a valid Definitions Package carries each Guard after the Guards it lists, whatever order it lists them in', () => {
    const userToken = defineGuard({ name: 'userToken', description: 'A signed-in user' });
    const permission = defineGuard({
      name: 'permission',
      description: 'The user holds a permission',
      guards: [userToken],
    });
    const definitions = defineDefinitions({});
    const rootExports = { permission, userToken };

    const validated = validateRoot(definitions, aRootPackage(definitions, { rootExports }));

    expect(validated.kind === 'valid' && validated.declarations.guards).toMatchObject([
      { guard: userToken },
      { guard: permission },
    ]);
  });

  test('a valid Definitions Package reaches every Guard and code it exports', () => {
    const definitions = defineDefinitions({});
    const rootExports = { apiKey, orderLocked, unauthenticated };

    const validated = validateRoot(definitions, aRootPackage(definitions, { rootExports }));

    expect(validated.kind === 'valid' && validated.declarations).toMatchObject({
      endpoints: [],
      guards: [{ guard: apiKey }],
      codes: [
        { code: 'UNAUTHENTICATED', rejection: unauthenticated },
        { code: 'ORDER_LOCKED', rejection: orderLocked },
      ],
    });
  });

  test('a valid Application returns no schemas and no Elements', () => {
    const paymentsDependency = defineDependency({ provider: payments, endpoints: [getPayment] });
    const application = defineApplication({
      name: 'web-admin',
      dependencies: [paymentsDependency],
    });

    const validated = validateInPackage(application);

    expect(validated).toMatchObject({
      kind: 'valid',
      schemas: { defs: {} },
      declarations: { endpoints: [], guards: [], codes: [] },
    });
  });

  test('an object with a bare _zod is no schema', () => {
    const impostor = { _zod: {} } as unknown as z.ZodObject;
    const createOrder = defineEndpoint({
      name: 'createOrder',
      method: 'POST',
      path: '/orders',
      visibility: 'public',
      description: 'Creates an order',
      input: { body: impostor },
      success: { status: 201, body: z.object({ id: z.uuid() }) },
    });
    const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [createOrder] });

    const validated = validateInPackage(
      defineService({ name: 'orders-service', groups: [orders] }),
    );

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: 'endpoints.POST /orders (createOrder) input.body',
          rule: 'not-a-schema',
          message: 'body is not a zod schema',
        },
      ],
    });
  });

  test.each([
    ['an object def without a shape', { _zod: { def: { type: 'object', shape: null } } }],
    ['an array def without an element', { _zod: { def: { type: 'array' } } }],
    ['a string def with garbage checks', { _zod: { def: { type: 'string', checks: [1] } } }],
  ])('%s is no schema and does not throw', (_name, impostor) => {
    const createOrder = defineEndpoint({
      name: 'createOrder',
      method: 'POST',
      path: '/orders',
      visibility: 'public',
      description: 'Creates an order',
      input: { body: impostor as unknown as z.ZodString },
      success: { status: 201, body: z.object({ id: z.uuid() }) },
    });
    const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [createOrder] });

    const validated = validateInPackage(
      defineService({ name: 'orders-service', groups: [orders] }),
    );

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: 'endpoints.POST /orders (createOrder) input.body',
          rule: 'not-a-schema',
          message: 'body is not a zod schema',
        },
      ],
    });
  });

  test('a fake schema as a Guard’s qualifier is no schema, and the Qualifier is not judged', () => {
    const fake = { _zod: { def: { type: 'object', shape: null } } } as unknown as z.ZodString;
    const quota = defineGuard({ name: 'quota', description: 'A quota', qualifier: fake });
    const listOrders = defineEndpoint({
      name: 'listOrders',
      method: 'GET',
      path: '/orders',
      visibility: 'public',
      description: 'Every order',
      guards: [{ guard: quota, qualifier: 'one' }],
      success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
    });
    const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [listOrders] });

    const validated = validateInPackage(
      defineService({ name: 'orders-service', groups: [orders] }),
    );

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: 'guards.quota qualifier',
          rule: 'not-a-schema',
          message: 'qualifier is not a zod schema',
        },
      ],
    });
  });

  test('a zod/mini schema and a schema of the built package are schemas', () => {
    const createOrder = defineEndpoint({
      name: 'createOrder',
      method: 'POST',
      path: '/orders',
      visibility: 'public',
      description: 'Creates an order',
      input: { body: zm.object({ total: zm.int() }) },
      success: { status: 201, body: z.object({ status: built.openEnum(['pending', 'paid']) }) },
    });
    const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [createOrder] });

    const validated = validateInPackage(
      defineService({ name: 'orders-service', groups: [orders] }),
    );

    expect(validated.kind).toBe('valid');
  });

  test('a Guard whose qualifier is null fails once, as no schema, whatever its Attachment', () => {
    const quota = defineGuard({
      name: 'quota',
      description: 'A quota',
      qualifier: null as unknown as z.ZodString,
    });
    const listOrders = defineEndpoint({
      name: 'listOrders',
      method: 'GET',
      path: '/orders',
      visibility: 'public',
      description: 'Every order',
      guards: [quota as unknown as Guard],
      success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
    });
    const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [listOrders] });

    const validated = validateInPackage(
      defineService({ name: 'orders-service', groups: [orders] }),
    );

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: 'guards.quota qualifier',
          rule: 'not-a-schema',
          message: 'qualifier is not a zod schema',
        },
      ],
    });
  });

  test('a null body in a schema slot fails once, as no schema', () => {
    const createOrder = defineEndpoint({
      name: 'createOrder',
      method: 'POST',
      path: '/orders',
      visibility: 'public',
      description: 'Creates an order',
      input: { body: null as unknown as z.ZodString },
      success: { status: 201, body: null as unknown as z.ZodString },
    });
    const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [createOrder] });

    const validated = validateInPackage(
      defineService({ name: 'orders-service', groups: [orders] }),
    );

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: 'endpoints.POST /orders (createOrder) input.body',
          rule: 'not-a-schema',
          message: 'body is not a zod schema',
        },
        {
          kind: 'declaration',
          location: 'endpoints.POST /orders (createOrder) success.body',
          rule: 'not-a-schema',
          message: 'body is not a zod schema',
        },
      ],
    });
  });

  test('a valid Definitions Package finds the nodes of its Guards, Rejections and shared schemas', () => {
    const money = z.object({ amount: z.int(), currency: z.string() });
    const definitions = defineDefinitions({});
    const located = [
      { at: aPlace('headers'), schema: apiKey.demands.headers },
      { at: aPlace('context'), schema: apiKey.context },
      { at: aPlace('lockedBody'), schema: orderLocked.body },
      { at: aPlace('money'), schema: money },
    ];
    const walked = walkSchemas(located, noOrigin);
    const rootExports = { apiKey, money, unauthenticated, orderLocked };

    const validated = validateRoot(definitions, aRootPackage(definitions, { rootExports }));

    const { nodeOf } = validated.kind === 'valid' ? validated.schemas : unreachable();
    expect([
      nodeOf(apiKey, 'demands.headers'),
      nodeOf(apiKey, 'context'),
      nodeOf(orderLocked, 'body'),
      nodeOf(money, 'schema'),
    ]).toEqual(walked.located.map(walkedNodeOf));
  });

  test('a construct that is not allowed fails with the walker’s failure at its location', () => {
    const createOrder = defineEndpoint({
      name: 'createOrder',
      method: 'POST',
      path: '/orders',
      visibility: 'public',
      description: 'Creates an order',
      // @ts-expect-error z.date() is refused by the types, as generate refuses it
      input: { body: z.object({ placedAt: z.date() }) },
      success: { status: 201, body: z.object({ id: z.uuid() }) },
    });
    const contract = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [createOrder] })],
    });

    const validated = validateInPackage(contract);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'not-allowed',
          location: 'endpoints.POST /orders (createOrder) input.body.placedAt',
          construct: 'z.date()',
          instead: 'z.iso.datetime()',
          alsoIn: [],
          origin: undefined,
        },
      ],
    });
  });

  test('a construct that is not allowed in one schema hides no failure of another', () => {
    const createOrder = defineEndpoint({
      name: 'createOrder',
      method: 'POST',
      path: '/orders',
      visibility: 'public',
      description: 'Creates an order',
      input: {
        // @ts-expect-error z.date() is refused by the types, as generate refuses it
        body: z.object({ placedAt: z.date() }),
        headers: z.object({ 'x-tenant': z.object({ id: z.string() }) }),
      },
      success: { status: 201, body: z.object({ id: z.uuid() }) },
    });
    const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [createOrder] });

    const validated = validateInPackage(
      defineService({ name: 'orders-service', groups: [orders] }),
    );

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: 'endpoints.POST /orders (createOrder) input.headers.x-tenant',
          rule: 'not-text',
          message: 'A header travels as text: a string, number, boolean, literal or enum: x-tenant',
        },
        {
          kind: 'not-allowed',
          location: 'endpoints.POST /orders (createOrder) input.body.placedAt',
          construct: 'z.date()',
          instead: 'z.iso.datetime()',
          alsoIn: [],
          origin: undefined,
        },
      ],
    });
  });

  test('declaration failures and Not allowed failures are reported together', () => {
    const createOrder = defineEndpoint({
      name: 'createOrder',
      method: 'POST',
      path: '/orders/',
      visibility: 'public',
      description: 'Creates an order',
      // @ts-expect-error z.date() is refused by the types, as generate refuses it
      input: { body: z.object({ placedAt: z.date() }) },
      success: { status: 201, body: z.object({ id: z.uuid() }) },
    });
    const contract = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [createOrder] })],
    });

    const validated = validateInPackage(contract);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: 'endpoints.POST /orders (createOrder) path',
          rule: 'canonical-path',
          message: 'A path has no trailing slash: "/orders/"',
        },
        {
          kind: 'not-allowed',
          location: 'endpoints.POST /orders (createOrder) input.body.placedAt',
          construct: 'z.date()',
          instead: 'z.iso.datetime()',
          alsoIn: [],
          origin: undefined,
        },
      ],
    });
  });
});

describe('validateRoot: the README’s examples', () => {
  const money = z.object({ amount: z.int(), currency: z.string() });
  const pagination = z.object({ page: z.int(), size: z.int() });
  const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });
  const userToken = defineGuard({
    name: 'userToken',
    description: 'A signed-in user',
    demands: { headers: z.object({ authorization: z.string() }) },
    context: z.object({ userId: z.string() }),
    rejections: [unauthenticated],
  });
  const permissionCode = z.enum(['orders:read', 'orders:edit', 'customers:read']);
  const permission = defineGuard({
    name: 'permission',
    description: 'The user holds every listed permission',
    guards: [userToken],
    qualifier: z.array(permissionCode).min(1),
    rejections: [forbidden],
  });
  const definitions = defineDefinitions({
    standardRejections: {
      invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'The request is invalid' },
      notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
      notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented yet' },
    },
  });
  const readmeGetOrder = defineEndpoint({
    name: 'getOrder',
    method: 'GET',
    path: '/orders/:orderId',
    visibility: 'public',
    description: 'One order by id',
    guards: [apiKey],
    input: { params: z.object({ orderId: z.uuid() }) },
    success: {
      status: 200,
      body: z.object({ id: z.uuid(), status: openEnum(['pending', 'paid']), total: money }),
    },
    rejections: [notFound, orderLocked],
  });
  const payment = z.object({
    type: openEnum(['card', 'transfer']),
    last4: z.string().optional(),
    iban: z.string().optional(),
  });
  const createOrder = defineEndpoint({
    name: 'createOrder',
    method: 'POST',
    path: '/orders',
    visibility: 'public',
    description: 'Creates an order',
    guards: [apiKey],
    input: { body: z.object({ total: money, payment }) },
    success: { status: 201, body: z.object({ id: z.uuid() }) },
  });
  const updateOrder = defineEndpoint({
    name: 'updateOrder',
    method: 'PUT',
    path: '/orders/:orderId',
    visibility: 'public',
    description: 'Replaces one order',
    guards: [userToken, { guard: permission, qualifier: ['orders:edit'] }],
    input: { params: z.object({ orderId: z.uuid() }), body: z.object({ total: money }) },
    success: { status: 204 },
  });
  const readmeOrders = defineGroup({
    name: 'orders',
    description: 'Order lifecycle',
    endpoints: [readmeGetOrder, createOrder, updateOrder],
  });
  const paymentsDependency = defineDependency({
    provider: payments,
    endpoints: [payments.endpoints.getPayment],
  });
  const contract = defineService({
    name: 'orders-service',
    standardRejections: definitions,
    groups: [readmeOrders],
    dependencies: [paymentsDependency],
  });

  test('the Service, its Definitions Package and an Application validate', () => {
    const application = defineApplication({
      name: 'web-admin',
      dependencies: [paymentsDependency],
    });

    const exported = { userToken, permission, money, pagination, unauthenticated, forbidden };
    const packages = [anInstalledPackage(definitions, exported)];
    const rootExports = exported;

    const validated = [contract, definitions, application].map(
      (root) => validateRoot(root, aRootPackage(root, { packages, rootExports })).kind,
    );

    expect(validated).toEqual(['valid', 'valid', 'valid']);
  });

  test('a Contract of 4000 Endpoints validates', () => {
    const endpoints = Array.from({ length: 4000 }, (_, index) =>
      defineEndpoint({
        name: `getItem${index}`,
        method: 'GET',
        path: `/items-${index}/:itemId`,
        visibility: 'public',
        description: 'One item',
        guards: [apiKey],
        input: { params: z.object({ itemId: z.uuid() }), query: z.object({ page: z.int() }) },
        success: { status: 200, body: z.object({ id: z.uuid() }) },
        rejections: [notFound, orderLocked],
      }),
    );
    const [first, ...rest] = endpoints;
    const items = defineGroup({
      name: 'items',
      description: 'Items',
      endpoints: [first!, ...rest],
    });

    const validated = validateInPackage(defineService({ name: 'orders-service', groups: [items] }));

    expect(validated.kind).toBe('valid');
  });

  test('the same Root validates to the same result twice', () => {
    const first = validateInPackage(contract);
    const second = validateInPackage(contract);

    const lookup = { nodeOf: expect.any(Function) };
    const expected =
      first.kind === 'valid' ? { ...first, schemas: { ...first.schemas, ...lookup } } : first;
    expect(second).toEqual(expected);
  });
});

function unreachable(): never {
  throw new Error('The fixture is invalid');
}
