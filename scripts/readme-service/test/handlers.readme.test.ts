import { notFound } from '@cf-loom/contract';
import { isRejectionOf } from '@cf-loom/handlers';
import { forbidden, unauthenticated } from '@org/definitions';
import { beforeEach, describe, expect, test } from 'vitest';
import getOrderHandler from '../src/endpoints/orders/get-order.handler.ts';
import apiKeyHandler from '../src/guards/api-key.handler.ts';
import permissionHandler from '../src/guards/permission.handler.ts';
import { notifications, ORDER_ID, resetServiceCode, resources } from '../src/service-code.ts';

beforeEach(resetServiceCode);

describe('the handlers README', () => {
  test('the EndpointHandler example answers its Success', async () => {
    const { outcome } = await import('../snippets/handlers-testing-a-services-own-code.ts');

    expect(outcome).toEqual({
      kind: 'success',
      status: 200,
      body: { id: ORDER_ID, status: 'paid', total: { amount: 1200, currency: 'EUR' } },
    });
  });

  test('the EndpointHandler example answers not found, told by its declaration', async () => {
    const outcome = await getOrderHandler(
      { params: { orderId: ORDER_ID } },
      { context: { apiKey: { callerId: 'c-2' } } },
      { resources },
    );

    expect(isRejectionOf(outcome, notFound)).toBe(true);
  });

  test('the GuardHandler example admits a known key and rejects an unknown one', async () => {
    const admissions = [
      await apiKeyHandler({ headers: { 'x-api-key': 'k-1' } }, {}, { resources }),
      await apiKeyHandler({ headers: { 'x-api-key': 'k-2' } }, {}, { resources }),
    ];

    expect(admissions).toMatchObject([
      { kind: 'admitted', context: { callerId: 'c-1' } },
      { kind: 'rejection', rejection: unauthenticated },
    ]);
  });

  test('the GuardHandler example rejects a request without a key as unauthenticated', async () => {
    const admission = await apiKeyHandler({ headers: {} }, {}, { resources });

    expect(admission).toMatchObject({ kind: 'rejection', rejection: unauthenticated });
  });

  test('the handlers README’s GuardHandler answers unauthenticated with its www-authenticate header', async () => {
    const admission = await apiKeyHandler({ headers: {} }, {}, { resources });

    expect(admission).toMatchObject({
      kind: 'rejection',
      headers: { 'www-authenticate': 'ApiKey realm="orders"' },
    });
  });

  test('the permission example reads the Context of the Guards it lists and its Qualifier', async () => {
    const context = { userToken: { userId: 'u-1' } };
    const admissions = [
      await permissionHandler({}, { context, qualifier: ['orders:edit'] }, { resources }),
      await permissionHandler({}, { context, qualifier: ['customers:read'] }, { resources }),
    ];

    expect(admissions).toMatchObject([
      { kind: 'admitted' },
      { kind: 'rejection', rejection: forbidden },
    ]);
  });

  test("the direct call of a Subscription's Message Handler receives its body and answers nothing", async () => {
    const { answer } = await import('../snippets/handlers-testing-a-services-own-code-2.ts');

    expect(answer).toBeUndefined();
    expect(notifications.sent).toEqual(['pay-1']);
  });
});
