import * as built from '@cf-loom/contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import * as zm from 'zod/mini';
import {
  type ContractPackage,
  defineApplication,
  defineContract,
  defineDefinitions,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Guard,
  notFound,
  openEnum,
} from '../index.ts';
import { type RootPackage, validateContract, walkSchemas } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: RootPackage['originOf']) {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  const packageName = typeof name === 'string' ? name : '';
  return validateContract(root, { originOf, packageName, exportsOf: () => [] });
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

const getPayment = defineEndpoint({
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
  version: '5.1.0',
  endpoints: { getPayment },
  events: {},
  standardRejections: {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

describe('validateContract', () => {
  test('a valid Contract finds the walked node of each declaration’s part', () => {
    const contract = defineContract({ name: 'orders-service', groups: [ordersGroup] });
    const located = [
      {
        at: ['groups', 'orders', 'endpoints', 'GET /orders/{}', 'input', 'params'],
        schema: getOrder.input.params,
      },
      {
        at: ['groups', 'orders', 'endpoints', 'GET /orders/{}', 'success', 'body'],
        schema: getOrder.success.body,
      },
      { at: ['guards', 'apiKey', 'demands', 'headers'], schema: apiKey.demands.headers },
      { at: ['guards', 'apiKey', 'context'], schema: apiKey.context },
      { at: ['rejections', 'ORDER_LOCKED', 'body'], schema: orderLocked.body },
    ];
    const walked = walkSchemas(located, noOrigin);

    const validated = validateInPackage(contract, noOrigin);

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

  test('a valid Contract carries its declarations in the root’s order: Endpoints by identity, Guards and codes reached, Standard Rejections resolved', () => {
    const shared = defineGuard({ name: 'shared', description: 'Listed, attached by no Endpoint' });
    const unused = defineRejection({ code: 'UNUSED', status: 410, message: 'Unused' });
    const definitions = defineDefinitions({
      name: 'definitions',
      guards: [shared],
      rejections: [unused],
      standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Missing' } },
    });
    const contract = defineContract({
      name: 'orders-service',
      definitions: [definitions],
      groups: [ordersGroup],
    });

    const validated = validateInPackage(contract, noOrigin);

    const listedIn = { at: ['definitions', 'definitions'], definitions };
    expect(validated.kind === 'valid' && validated.declarations).toEqual({
      root: contract,
      endpoints: [
        {
          at: ['groups', 'orders', 'endpoints', 'GET /orders/{}'],
          endpoint: getOrder,
          group: ordersGroup,
        },
      ],
      guards: [
        { at: ['guards', 'apiKey'], guard: apiKey, reached: true, listedIn: undefined },
        { at: ['guards', 'shared'], guard: shared, reached: false, listedIn },
      ],
      codes: [
        {
          code: 'UNUSED',
          at: ['rejections', 'UNUSED'],
          rejection: unused,
          reached: false,
          listedIn,
        },
        {
          code: 'UNAUTHENTICATED',
          at: ['rejections', 'UNAUTHENTICATED'],
          rejection: unauthenticated,
          reached: true,
          listedIn: undefined,
        },
        {
          code: 'ORDER_LOCKED',
          at: ['rejections', 'ORDER_LOCKED'],
          rejection: orderLocked,
          reached: true,
          listedIn: undefined,
        },
      ],
      standardRejections: [
        {
          name: 'invalidInput',
          at: ['definitions', 'definitions', 'standardRejections', 'invalidInput'],
          code: 'INVALID_INPUT',
          status: 400,
          message: 'Invalid input',
          declared: undefined,
        },
        {
          name: 'notFound',
          at: ['definitions', 'definitions', 'standardRejections', 'notFound'],
          code: 'MISSING',
          status: 404,
          message: 'Missing',
          declared: {
            at: ['definitions', 'definitions', 'standardRejections', 'notFound'],
            name: 'notFound',
            declaration: { code: 'MISSING', status: 404, message: 'Missing' },
            listedIn,
          },
        },
        {
          name: 'notImplemented',
          at: ['definitions', 'definitions', 'standardRejections', 'notImplemented'],
          code: 'NOT_IMPLEMENTED',
          status: 501,
          message: 'Not implemented',
          declared: undefined,
        },
      ],
      dependencies: [],
    });
  });

  test('a valid Definitions Package carries each Guard after the Guards it lists, whatever order it lists them in', () => {
    const userToken = defineGuard({ name: 'userToken', description: 'A signed-in user' });
    const permission = defineGuard({
      name: 'permission',
      description: 'The user holds a permission',
      guards: [userToken],
    });
    const definitions = defineDefinitions({
      name: 'definitions',
      guards: [permission, userToken],
    });

    const validated = validateInPackage(definitions, noOrigin);

    expect(validated.kind === 'valid' && validated.declarations.guards).toMatchObject([
      { guard: userToken },
      { guard: permission },
    ]);
  });

  test('a valid Definitions Package reaches every Guard and code it declares', () => {
    const definitions = defineDefinitions({
      name: 'definitions',
      guards: [apiKey],
      rejections: [orderLocked, unauthenticated],
    });

    const validated = validateInPackage(definitions, noOrigin);

    expect(validated.kind === 'valid' && validated.declarations).toMatchObject({
      endpoints: [],
      guards: [{ guard: apiKey, reached: true }],
      codes: [
        { code: 'ORDER_LOCKED', rejection: orderLocked, reached: true },
        { code: 'UNAUTHENTICATED', rejection: unauthenticated, reached: true },
      ],
    });
  });

  test('a valid Application returns no schemas and no Elements', () => {
    const paymentsDeps = defineDependencies(payments, { endpoints: [getPayment] });
    const application = defineApplication({ name: 'web-admin', dependencies: [paymentsDeps] });

    const validated = validateInPackage(application, noOrigin);

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
      defineContract({ name: 'orders-service', groups: [orders] }),
      noOrigin,
    );

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['groups', 'orders', 'endpoints', 'POST /orders', 'input', 'body'],
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
      defineContract({ name: 'orders-service', groups: [orders] }),
      noOrigin,
    );

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['groups', 'orders', 'endpoints', 'POST /orders', 'input', 'body'],
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
      defineContract({ name: 'orders-service', groups: [orders] }),
      noOrigin,
    );

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['guards', 'quota', 'qualifier'],
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
      defineContract({ name: 'orders-service', groups: [orders] }),
      noOrigin,
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
      defineContract({ name: 'orders-service', groups: [orders] }),
      noOrigin,
    );

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['guards', 'quota', 'qualifier'],
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
      defineContract({ name: 'orders-service', groups: [orders] }),
      noOrigin,
    );

    const endpointAt = ['groups', 'orders', 'endpoints', 'POST /orders'];
    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: [...endpointAt, 'input', 'body'],
          rule: 'not-a-schema',
          message: 'body is not a zod schema',
        },
        {
          kind: 'declaration',
          at: [...endpointAt, 'success', 'body'],
          rule: 'not-a-schema',
          message: 'body is not a zod schema',
        },
      ],
    });
  });

  test('a valid Definitions Package finds the nodes of its Guards, Rejections and shared schemas', () => {
    const money = z.object({ amount: z.int(), currency: z.string() });
    const definitions = defineDefinitions({
      name: 'definitions',
      guards: [apiKey],
      schemas: { money },
      rejections: [unauthenticated, orderLocked],
    });
    const located = [
      { at: ['guards', 'apiKey', 'demands', 'headers'], schema: apiKey.demands.headers },
      { at: ['guards', 'apiKey', 'context'], schema: apiKey.context },
      { at: ['rejections', 'ORDER_LOCKED', 'body'], schema: orderLocked.body },
      { at: ['schemas', 'money'], schema: money },
    ];
    const walked = walkSchemas(located, noOrigin);

    const validated = validateInPackage(definitions, noOrigin);

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
      input: { body: z.object({ placedAt: z.date() }) },
      success: { status: 201, body: z.object({ id: z.uuid() }) },
    });
    const contract = defineContract({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [createOrder] })],
    });

    const validated = validateInPackage(contract, noOrigin);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'not-allowed',
          at: [
            'groups',
            'orders',
            'endpoints',
            'POST /orders',
            'input',
            'body',
            'fields',
            'placedAt',
          ],
          construct: 'z.date()',
          instead: 'z.iso.datetime()',
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
        body: z.object({ placedAt: z.date() }),
        headers: z.object({ 'x-tenant': z.object({ id: z.string() }) }),
      },
      success: { status: 201, body: z.object({ id: z.uuid() }) },
    });
    const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [createOrder] });

    const validated = validateInPackage(
      defineContract({ name: 'orders-service', groups: [orders] }),
      noOrigin,
    );

    const endpointAt = ['groups', 'orders', 'endpoints', 'POST /orders'];
    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: [...endpointAt, 'input', 'headers', 'fields', 'x-tenant'],
          rule: 'not-text',
          message: 'A header travels as text: a string, number, boolean, literal or enum: x-tenant',
        },
        {
          kind: 'not-allowed',
          at: [...endpointAt, 'input', 'body', 'fields', 'placedAt'],
          construct: 'z.date()',
          instead: 'z.iso.datetime()',
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
      input: { body: z.object({ placedAt: z.date() }) },
      success: { status: 201, body: z.object({ id: z.uuid() }) },
    });
    const contract = defineContract({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [createOrder] })],
    });

    const validated = validateInPackage(contract, noOrigin);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['groups', 'orders', 'endpoints', 'POST /orders', 'path'],
          rule: 'canonical-path',
          message: 'A path has no trailing slash: /orders/',
        },
        {
          kind: 'not-allowed',
          at: [
            'groups',
            'orders',
            'endpoints',
            'POST /orders',
            'input',
            'body',
            'fields',
            'placedAt',
          ],
          construct: 'z.date()',
          instead: 'z.iso.datetime()',
        },
      ],
    });
  });
});

describe('validateContract: the README’s examples', () => {
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
    name: 'definitions',
    guards: [userToken, permission],
    schemas: { money, pagination },
    rejections: [unauthenticated, forbidden],
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
  const paymentsDeps = defineDependencies(payments, { endpoints: [payments.endpoints.getPayment] });
  const contract = defineContract({
    name: 'orders-service',
    definitions: [definitions],
    groups: [readmeOrders],
    dependencies: [paymentsDeps],
  });

  test('the Service, its Definitions Package and an Application validate', () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [paymentsDeps] });

    const validated = [contract, definitions, application].map(
      (root) => validateInPackage(root, noOrigin).kind,
    );

    expect(validated).toEqual(['valid', 'valid', 'valid']);
  });

  test('a code declared twice is written once, as its first declaration, and compared from both', () => {
    const lockedAgain = defineRejection({
      code: 'ORDER_LOCKED',
      status: 409,
      message: 'Locked',
      body: z.object({ lockedAt: z.iso.datetime().describe('When it locked') }),
    });
    const retryOrder = defineEndpoint({
      name: 'retryOrder',
      method: 'POST',
      path: '/orders/:orderId/retry',
      visibility: 'public',
      description: 'Retries one order',
      input: { params: z.object({ orderId: z.uuid() }) },
      success: { status: 204 },
      rejections: [lockedAgain],
    });
    const group = defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [getOrder, retryOrder],
    });

    const validated = validateInPackage(
      defineContract({ name: 'orders-service', groups: [group] }),
      noOrigin,
    );

    const { schemas, declarations } = validated.kind === 'valid' ? validated : unreachable();
    const written = declarations.codes.find(({ code }) => code === 'ORDER_LOCKED');
    expect(written?.rejection).toBe(orderLocked);
    expect(schemas.nodeOf(written?.rejection, 'body')).toEqual({
      type: 'object',
      mode: 'open',
      fields: { lockedAt: { required: true, schema: { type: 'string', format: 'datetime' } } },
    });
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

    const validated = validateInPackage(
      defineContract({ name: 'orders-service', groups: [items] }),
      noOrigin,
    );

    expect(validated.kind).toBe('valid');
  });

  test('the same root validates to the same result twice', () => {
    const first = validateInPackage(contract, noOrigin);
    const second = validateInPackage(contract, noOrigin);

    const lookup = { nodeOf: expect.any(Function) };
    const expected =
      first.kind === 'valid' ? { ...first, schemas: { ...first.schemas, ...lookup } } : first;
    expect(second).toEqual(expected);
  });
});

function unreachable(): never {
  throw new Error('The fixture is invalid');
}
