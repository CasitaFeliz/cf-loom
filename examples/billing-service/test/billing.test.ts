import { FakeProviderError, fakeProvider } from '@cf-loom/testing';
import { contract as orders } from '@org/contract-orders-service';
import { describe, expect, test } from 'vitest';
import { invoiceFor } from '../src/billing/invoice-for.ts';
import { ordersDependency } from '../src/contract/dependencies/orders-service.dependency.ts';

const ORDER_ID = '7d4f0a52-3c1b-4e8a-9f6d-1a2b3c4d5e6f';
const total = { amount: 4200, currency: 'EUR' };
const paidOrder = {
  id: ORDER_ID,
  customerId: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
  status: 'paid',
  total,
  placedAt: '2026-01-10T12:00:00Z',
} as const;

/** orders-service faked, and a client over it holding billing's key. */
function fakeOrders() {
  const fake = fakeProvider(ordersDependency);
  const client = fake.client({ headers: { 'x-api-key': 'billing-key' } });
  return { fake, client };
}

describe('invoiceFor', () => {
  test('a paid order is billed for its total', async () => {
    const { fake, client } = fakeOrders();
    fake.on('getOrder').otherwise((r) => r.success(paidOrder));

    const invoicing = await invoiceFor(client, ORDER_ID);

    expect(invoicing).toMatchObject({ kind: 'invoice', invoice: { orderId: ORDER_ID, total } });
  });

  test('a pending order is not billable', async () => {
    const { fake, client } = fakeOrders();
    fake.on('getOrder').otherwise((r) => r.success({ ...paidOrder, status: 'pending' }));

    const invoicing = await invoiceFor(client, ORDER_ID);

    expect(invoicing).toEqual({ kind: 'not-billable', orderStatus: 'pending' });
  });

  test('a status orders-service adds later arrives as its Unknown case and is not billable', async () => {
    const { fake, client } = fakeOrders();
    const refunded = { ...paidOrder, status: { unknown: 'refunded' } };
    fake.on('getOrder').otherwise((r) => r.success(refunded));

    const invoicing = await invoiceFor(client, ORDER_ID);

    expect(invoicing).toEqual({ kind: 'not-billable', orderStatus: 'refunded' });
  });

  test('a cancelled order is not billable', async () => {
    const { fake, client } = fakeOrders();
    fake.on('getOrder').otherwise((r) => r.success({ ...paidOrder, status: 'cancelled' }));

    const invoicing = await invoiceFor(client, ORDER_ID);

    expect(invoicing).toEqual({ kind: 'not-billable', orderStatus: 'cancelled' });
  });

  test('a shipped order is billed, since it was paid', async () => {
    const { fake, client } = fakeOrders();
    fake.on('getOrder').otherwise((r) => r.success({ ...paidOrder, status: 'shipped' }));

    const invoicing = await invoiceFor(client, ORDER_ID);

    expect(invoicing.kind).toBe('invoice');
  });

  test('a locked order is locked, with the instant orders-service locked it', async () => {
    const { fake, client } = fakeOrders();
    const lockedAt = '2026-01-15T09:30:00Z';
    fake.on('getOrder').otherwise((r) => r.reject('ORDER_LOCKED', { lockedAt }));

    const invoicing = await invoiceFor(client, ORDER_ID);

    expect(invoicing).toEqual({ kind: 'locked', lockedAt });
  });

  test('an order orders-service does not know is not found', async () => {
    const { fake, client } = fakeOrders();
    fake.on('getOrder').otherwise((r) => r.reject('RESOURCE_NOT_FOUND'));

    const invoicing = await invoiceFor(client, ORDER_ID);

    expect(invoicing).toEqual({ kind: 'not-found' });
  });

  test('no connection is retried once, then the order is billed', async () => {
    const { fake, client } = fakeOrders();
    fake
      .on('getOrder')
      .once((r) => r.noConnection())
      .otherwise((r) => r.success(paidOrder));

    const invoicing = await invoiceFor(client, ORDER_ID);

    expect(invoicing.kind).toBe('invoice');
    expect(fake.calls('getOrder')).toHaveLength(2);
  });

  test('no connection after the retry leaves orders-service unavailable, retryable', async () => {
    const { fake, client } = fakeOrders();
    fake.on('getOrder').otherwise((r) => r.noConnection());

    const invoicing = await invoiceFor(client, ORDER_ID);

    expect(invoicing).toEqual({ kind: 'unavailable', retryable: true });
    expect(fake.calls('getOrder')).toHaveLength(2);
  });

  test('a Fault that changed nothing but is not retryable is not retried', async () => {
    const { fake, client } = fakeOrders();
    fake.on('getOrder').otherwise((r) => r.fault({ committed: 'no', retryable: false }));

    const invoicing = await invoiceFor(client, ORDER_ID);

    expect(invoicing).toEqual({ kind: 'unavailable', retryable: false });
    expect(fake.calls('getOrder')).toHaveLength(1);
  });

  test.each([
    ['a reset after sending', 'reset', true],
    ['a 502', 'status', false],
    ['a code orders-service does not declare', 'unknown-code', false],
  ] as const)(
    '%s leaves orders-service unavailable, never retried',
    async (_, answer, retryable) => {
      const { fake, client } = fakeOrders();
      fake.on('getOrder').otherwise((respond) => {
        switch (answer) {
          case 'reset':
            return respond.reset();
          case 'status':
            return respond.status(502);
          case 'unknown-code':
            return respond.reject({ unknown: 'ORDER_ARCHIVED' }, {});
        }
      });

      const invoicing = await invoiceFor(client, ORDER_ID);

      expect(invoicing).toEqual({ kind: 'unavailable', retryable });
      expect(fake.calls('getOrder')).toHaveLength(1);
    },
  );

  test.each(['UNAUTHENTICATED', 'NOT_YET_IMPLEMENTED', 'BAD_REQUEST'] as const)(
    '%s leaves orders-service unavailable, not retryable',
    async (code) => {
      const { fake, client } = fakeOrders();
      fake.on('getOrder').otherwise((respond) => {
        switch (code) {
          case 'UNAUTHENTICATED':
            return respond.reject('UNAUTHENTICATED');
          case 'NOT_YET_IMPLEMENTED':
            return respond.reject('NOT_YET_IMPLEMENTED');
          case 'BAD_REQUEST':
            return respond.reject('BAD_REQUEST', { issues: [] });
        }
      });

      const invoicing = await invoiceFor(client, ORDER_ID);

      expect(invoicing).toEqual({ kind: 'unavailable', retryable: false });
    },
  );

  test('a scripted order that breaks orders-service’s Contract fails the test', async () => {
    const { fake, client } = fakeOrders();
    const badTotal = { amount: 4200, currency: 'EURO' };
    fake.on('getOrder').otherwise((r) => r.success({ ...paidOrder, total: badTotal }));

    const invoicing = invoiceFor(client, ORDER_ID);

    await expect(invoicing).rejects.toBeInstanceOf(FakeProviderError);
  });
});

describe('a client of the faked orders-service', () => {
  test('an order id that is no UUID is answered BAD_REQUEST and never sent', async () => {
    const { fake, client } = fakeOrders();

    const outcome = await client.getOrder({ params: { orderId: 'o-1' } });

    expect(outcome).toMatchObject({
      kind: 'rejection',
      known: true,
      code: 'BAD_REQUEST',
      message: 'The request is invalid',
    });
    expect(fake.calls('getOrder')).toHaveLength(0);
  });

  test('cf-loom’s default NOT_FOUND is a type error and a mistake for the fake', async () => {
    const { fake, client } = fakeOrders();
    // @ts-expect-error orders-service answers RESOURCE_NOT_FOUND, never cf-loom's default code
    fake.on('getOrder').otherwise((r) => r.reject('NOT_FOUND'));

    const invoicing = invoiceFor(client, ORDER_ID);

    await expect(invoicing).rejects.toBeInstanceOf(FakeProviderError);
  });
});

describe('the Contract Package of orders-service', () => {
  test('it exports the Public and Internal Endpoints, never the Private health', () => {
    const exported = Object.keys(orders.endpoints);

    expect(exported).toEqual(['createOrder', 'getOrder']);
  });
});
