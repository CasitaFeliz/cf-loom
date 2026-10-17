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
} from './index.ts';

const money = z.object({ amount: z.int(), currency: z.string() });
const pagination = z.object({ page: z.int(), size: z.int() });
const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
});
const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });
const userToken = defineGuard({
  name: 'userToken',
  description: 'A signed-in user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
  rejections: [unauthenticated],
});

const definitions = defineDefinitions({
  name: 'definitions',
  guards: [userToken],
  schemas: { money, pagination },
  rejections: [unauthenticated, forbidden],
  standardRejections: {
    invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'The request is invalid' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented yet' },
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
  description: 'An API key per client',
  demands: {
    headers: z.object({ 'x-api-key': z.string() }),
  },
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
  input: {
    params: z.object({ orderId: z.uuid() }),
  },
  success: {
    status: 200,
    body: z.object({
      id: z.uuid(),
      status: openEnum(['pending', 'paid']),
      total: money,
    }),
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
  input: {
    body: z.object({ total: money, payment: openUnion('type', [card, transfer]) }),
  },
  success: { status: 201, body: z.object({ id: z.uuid() }) },
});

const ordersGroup = defineGroup({
  name: 'orders',
  description: 'Order lifecycle',
  endpoints: [getOrder, createOrder],
});

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'public',
  description: 'One payment by id',
  input: { params: z.object({ paymentId: z.uuid() }) },
  success: { status: 200, body: z.object({ amount: money }) },
  rejections: [notFound],
});

const payments = {
  name: 'payments-service',
  version: '5.1.0',
  endpoints: { getPayment },
  events: {
    paymentSettledV1: {
      kind: 'event',
      name: 'PaymentSettled',
      version: 1,
      visibility: 'internal',
    },
  },
  standardRejections: {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
} as const satisfies ContractPackage;

const paymentsDeps = defineDependencies(payments, {
  endpoints: [payments.endpoints.getPayment],
  events: [payments.events.paymentSettledV1],
});

const orders = {
  name: 'orders-service',
  version: '3.4.0',
  endpoints: { getOrder, createOrder },
  events: {},
  standardRejections: payments.standardRejections,
} as const satisfies ContractPackage;

describe('the README’s declaration examples', () => {
  test('a Service root lists its Definitions Packages, Groups and Dependencies', () => {
    const contract = defineContract({
      name: 'orders-service',
      definitions: [definitions],
      groups: [ordersGroup],
      dependencies: [paymentsDeps],
    });

    expect(contract.groups[0].endpoints[0].success.body.shape.total).toBe(money);
  });

  test('an Application depends on the Public Endpoints of each Provider', () => {
    const ordersDeps = defineDependencies(orders, { endpoints: [orders.endpoints.getOrder] });
    const paymentsDeps = defineDependencies(payments, {
      endpoints: [payments.endpoints.getPayment],
    });

    const application = defineApplication({
      name: 'web-admin',
      dependencies: [ordersDeps, paymentsDeps],
    });

    expect(application.dependencies[1].endpoints.getPayment).toBe(getPayment);
  });
});
