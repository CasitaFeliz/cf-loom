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
