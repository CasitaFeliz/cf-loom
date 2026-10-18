import { describe, expect, test } from 'vitest';
import { z } from 'zod';
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
  notFound,
  openEnum,
  openUnion,
} from '../index.ts';
import { validateContract, walkSchemas } from '../internal/index.ts';

function noOrigin() {
  return undefined;
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
  description: 'An API key per client',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ clientId: z.string() }),
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
} as const satisfies ContractPackage;

describe('validateContract', () => {
  test('a valid Contract returns its walked schemas by location', () => {
    const contract = defineContract({ name: 'orders-service', groups: [ordersGroup] });
    const located = [
      {
        at: ['groups', 'orders', 'endpoints', 'getOrder', 'input', 'params'],
        schema: getOrder.input.params,
      },
      {
        at: ['groups', 'orders', 'endpoints', 'getOrder', 'success', 'body'],
        schema: getOrder.success.body,
      },
      { at: ['guards', 'apiKey', 'demands', 'headers'], schema: apiKey.demands.headers },
      { at: ['guards', 'apiKey', 'context'], schema: apiKey.context },
      { at: ['rejections', 'ORDER_LOCKED', 'body'], schema: orderLocked.body },
    ];
    const walked = walkSchemas(located, noOrigin);

    const validated = validateContract(contract, noOrigin);

    expect(walked.kind).toBe('walked');
    const nodes = walked.kind === 'walked' ? walked.nodes : [];
    expect(validated).toEqual({
      kind: 'valid',
      schemas: {
        nodes: located.map(({ at }, index) => ({ at, node: nodes[index] })),
        defs: {},
      },
    });
  });

  test('a valid Application returns no schemas', () => {
    const paymentsDeps = defineDependencies(payments, { endpoints: [getPayment] });
    const application = defineApplication({ name: 'web-admin', dependencies: [paymentsDeps] });

    const validated = validateContract(application, noOrigin);

    expect(validated).toEqual({ kind: 'valid', schemas: { nodes: [], defs: {} } });
  });

  test('a valid Definitions Package returns its Guards’, Rejections’ and shared schemas by location', () => {
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

    const validated = validateContract(definitions, noOrigin);

    expect(walked.kind).toBe('walked');
    const nodes = walked.kind === 'walked' ? walked.nodes : [];
    expect(validated).toEqual({
      kind: 'valid',
      schemas: {
        nodes: located.map(({ at }, index) => ({ at, node: nodes[index] })),
        defs: {},
      },
    });
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

    const validated = validateContract(contract, noOrigin);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          at: [
            'groups',
            'orders',
            'endpoints',
            'createOrder',
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

    const validated = validateContract(contract, noOrigin);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          at: ['groups', 'orders', 'endpoints', 'createOrder', 'path'],
          rule: 'canonical-path',
          message: 'A path has no trailing slash: /orders/',
        },
        {
          at: [
            'groups',
            'orders',
            'endpoints',
            'createOrder',
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
  const card = z.object({ type: z.literal('card'), last4: z.string() });
  const transfer = z.object({ type: z.literal('transfer'), iban: z.string() });
  const createOrder = defineEndpoint({
    name: 'createOrder',
    method: 'POST',
    path: '/orders',
    visibility: 'public',
    description: 'Creates an order',
    guards: [apiKey],
    input: { body: z.object({ total: money, payment: openUnion('type', [card, transfer]) }) },
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
      (root) => validateContract(root, noOrigin).kind,
    );

    expect(validated).toEqual(['valid', 'valid', 'valid']);
  });

  test('the same root validates to the same result twice', () => {
    const first = validateContract(contract, noOrigin);
    const second = validateContract(contract, noOrigin);

    expect(second).toEqual(first);
  });
});
