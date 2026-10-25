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
  openEnum,
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

const permissionCode = z.enum(['orders:read', 'orders:edit', 'customers:read']);

const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken],
  qualifier: z.array(permissionCode).min(1),
  rejections: [forbidden],
});

const definitions = defineDefinitions({
  guards: [userToken, permission],
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
  description: 'An API key per Caller',
  demands: {
    headers: z.object({ 'x-api-key': z.string() }),
  },
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
  input: {
    body: z.object({ total: money, payment }),
  },
  success: { status: 201, body: z.object({ id: z.uuid() }) },
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
    paymentSettledV1: defineEvent({
      name: 'PaymentSettled',
      version: 1,
      visibility: 'internal',
      description: 'A payment was settled',
      body: z.object({ paymentId: z.uuid() }),
    }),
  },
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
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

const paymentsDependency = defineDependency({
  provider: payments,
  endpoints: [payments.endpoints.getPayment],
});

const orders = {
  name: 'orders-service',
  version: '3.4.0',
  endpoints: { getOrder, createOrder },
  events: {},
  standardRejections: payments.standardRejections,
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was placed, with its total',
  body: z.object({ orderId: z.uuid(), total: money }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the card an order is paid with',
  body: z.object({ orderId: z.uuid() }),
});

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  lifecycle: 'deprecated',
  body: z.object({ orderId: z.uuid(), total: z.number() }),
});

const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notifies the customer of each payment settled',
  event: payments.events.paymentSettledV1,
});

const ordersGroup = defineGroup({
  name: 'orders',
  description: 'Order lifecycle',
  endpoints: [getOrder, createOrder],
  events: [orderCreatedV1, orderCreatedV2],
  commands: [chargeCardV1],
  subscriptions: [notifyOnSettled],
});

describe('the README’s declaration examples', () => {
  test('a Service root lists its Definitions Packages, its Groups, which list its Elements and Subscriptions, and its Dependencies', () => {
    const contract = defineContract({
      name: 'orders-service',
      definitions: [definitions],
      groups: [ordersGroup],
      dependencies: [paymentsDependency],
    });

    expect(contract.groups[0].endpoints[0].success.body.shape.total).toBe(money);
    expect(contract.groups[0].subscriptions[0].event).toBe(payments.events.paymentSettledV1);
  });

  test('an Application depends on the Public Endpoints of each Provider', () => {
    const adminOrdersDependency = defineDependency({
      provider: orders,
      endpoints: [orders.endpoints.getOrder],
    });
    const adminPaymentsDependency = defineDependency({
      provider: payments,
      endpoints: [payments.endpoints.getPayment],
    });

    const application = defineApplication({
      name: 'web-admin',
      dependencies: [adminOrdersDependency, adminPaymentsDependency],
    });

    expect(application.dependencies[1].endpoints).toEqual([getPayment]);
  });
});

describe('the README’s Event and Command examples', () => {
  test('an Event takes a Visibility and a Command none', () => {
    expect(orderCreatedV2).toMatchObject({ kind: 'event', visibility: 'internal' });
    expect(chargeCardV1).not.toHaveProperty('visibility');
  });

  test('a Deprecated Event version sits beside the Active one', () => {
    expect(orderCreatedV1.lifecycle).toBe('deprecated');
    expect(orderCreatedV2).not.toHaveProperty('lifecycle');
  });
});

describe('the README’s Subscription example', () => {
  test('a Subscription takes a Provider’s Event from its Contract Package', () => {
    expect(notifyOnSettled.event).toBe(payments.events.paymentSettledV1);
  });

  test('the Dependency holds the Contract Package and the Endpoints it calls, as listed', () => {
    expect(paymentsDependency.provider.events.paymentSettledV1).toBe(notifyOnSettled.event);
    expect(paymentsDependency.endpoints).toEqual([getPayment]);
  });
});

describe('the README’s Guard examples', () => {
  test('an Endpoint lists every Guard itself, in order', () => {
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

    expect(updateOrder.guards[1].qualifier).toEqual(['orders:edit']);
  });
});
