import { getPaymentEndpoint, paymentSettledEventV1 } from '@org/contract-payments-service';
import {
  apiKey,
  definitions,
  money,
  permission,
  unauthenticated,
  userToken,
} from '@org/definitions';
import { describe, expect, test } from 'vitest';
import { paymentsDependency } from '../src/contract/dependencies/payments-service.dependency.ts';
import { editOrder } from '../src/contract/endpoints/orders/edit-order.endpoint.ts';
import { getOrder } from '../src/contract/endpoints/orders/get-order.endpoint.ts';
import { listOrders } from '../src/contract/endpoints/orders/list-orders.endpoint.ts';
import { orderCreatedV1 } from '../src/contract/events/orders/order-created.v1.event.ts';
import { orderCreatedV2 } from '../src/contract/events/orders/order-created.v2.event.ts';
import { ordersGroup } from '../src/contract/groups/orders.group.ts';
import { contract } from '../src/contract/index.ts';
import { notifyOnSettled } from '../src/contract/subscriptions/orders/notify-on-settled.subscription.ts';
import { application } from '../web-admin/src/contract/index.ts';

describe('the contract README’s declaration examples', () => {
  test('a Service’s Root takes its Standard Rejections from the Definitions Package', () => {
    expect(contract.standardRejections).toBe(definitions);
  });

  test('a Service’s Root lists its Groups, which list its Elements and Subscriptions', () => {
    expect(contract.groups[0]).toBe(ordersGroup);
    expect(ordersGroup.endpoints[0]).toBe(getOrder);
    expect(ordersGroup.subscriptions[0]).toBe(notifyOnSettled);
  });

  test('a Service’s Root lists its Dependencies', () => {
    expect(contract.dependencies[0]).toBe(paymentsDependency);
  });

  test('an Endpoint’s Success body takes a shared schema from the Definitions Package', () => {
    expect(getOrder.success.body.shape.total).toBe(money);
  });

  test('an Endpoint attaches the Definitions Package’s apiKey Guard, which rejects with its unauthenticated Rejection', () => {
    expect(getOrder.guards[0]).toBe(apiKey);
    expect(apiKey.rejections[0]).toBe(unauthenticated);
  });

  test('an Application depends on the Public Endpoints of each Provider', () => {
    expect(application.dependencies[0].endpoints[0]).toBe(getPaymentEndpoint);
  });

  test('a Deprecated Endpoint states the instant it is Deprecated as of', () => {
    expect(listOrders).toMatchObject({
      lifecycle: 'deprecated',
      deprecatedAt: '2026-11-01T00:00:00Z',
    });
  });

  test('a Deprecated Event version sits beside the Active one', () => {
    expect(orderCreatedV1.lifecycle).toBe('deprecated');
    expect(ordersGroup.events).toEqual([orderCreatedV1, orderCreatedV2]);
  });

  test('a Subscription takes a Provider’s Event from its Contract Package', () => {
    expect(notifyOnSettled.event).toBe(paymentSettledEventV1);
  });

  test('the Dependency holds the Endpoints it calls, as listed, and no Event', () => {
    expect(paymentsDependency).toEqual({ kind: 'dependency', endpoints: [getPaymentEndpoint] });
  });

  test('the Guard leaves the key optional, so its Handler decides on a request without one', () => {
    const withoutKey = apiKey.demands.headers.safeParse({});

    expect(withoutKey.success).toBe(true);
  });

  test('an Endpoint lists every Guard itself, in order', () => {
    expect(editOrder.guards[0]).toBe(userToken);
    expect(editOrder.guards[1]).toEqual({ guard: permission, qualifier: ['orders:edit'] });
  });
});
