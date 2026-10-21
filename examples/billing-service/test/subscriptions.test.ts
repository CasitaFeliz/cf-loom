import type { Messaging } from '@cf-loom/messaging';
import { type MemoryBroker, memory } from '@cf-loom/messaging/memory';
import { fakeEvent } from '@cf-loom/testing';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { draftsOf } from '../src/billing/drafts.ts';
import { ordersDeps } from '../src/contract/dependencies/orders-service.dependencies.ts';
import type { contract } from '../src/contract/index.ts';
import handlers from '../src/handlers.generated.ts';
import { startMessaging } from '../src/messaging.ts';
import draftInvoiceOnCreatedHandler from '../src/subscriptions/draft-invoice-on-created.handler.ts';

const DELIVERED_ORDER_ID = 'a1f0c3d2-5b4e-4c6a-9d8e-7f6a5b4c3d2e';
const REPEATED_ORDER_ID = 'b2e1d4c3-6a5f-4d7b-8e9f-0a1b2c3d4e5f';
const CALLED_ORDER_ID = 'c3d2e5f4-7b6a-4e8c-9f0a-1b2c3d4e5f60';
const CUSTOMER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const orderCreated = ordersDeps.events.orderCreatedV1;
const total = { amount: 1500, currency: 'EUR' };

function anOrderCreated(orderId: string) {
  return fakeEvent(orderCreated, { orderId, customerId: CUSTOMER_ID, total });
}

describe('draft-invoice-on-created over the memory adapter', () => {
  let broker: MemoryBroker;
  let running: Messaging<typeof contract>;

  beforeEach(async () => {
    broker = memory();
    running = await startMessaging(broker);
    await running.consume(handlers);
  });

  afterEach(async () => {
    await running.close();
  });

  test('an OrderCreated delivered through memory() is acknowledged and drafts an invoice for the order’s total', async () => {
    const body = anOrderCreated(DELIVERED_ORDER_ID);

    const settlement = await broker.deliver(orderCreated, body);

    expect(settlement).toBe('acked');
    expect(draftsOf(DELIVERED_ORDER_ID)).toEqual([{ orderId: DELIVERED_ORDER_ID, total }]);
  });

  test('an OrderCreated delivered twice for the same fact drafts one invoice', async () => {
    const body = anOrderCreated(REPEATED_ORDER_ID);
    const meta = { factId: `${REPEATED_ORDER_ID}:created` };

    await broker.deliver(orderCreated, body, meta);
    await broker.deliver(orderCreated, body, meta);

    expect(draftsOf(REPEATED_ORDER_ID)).toEqual([{ orderId: REPEATED_ORDER_ID, total }]);
  });
});

describe('draft-invoice-on-created called directly', () => {
  test('with a faked OrderCreated, the Handler drafts the invoice', async () => {
    const body = anOrderCreated(CALLED_ORDER_ID);
    const factId = `${CALLED_ORDER_ID}:created`;
    const meta = { messageId: `OrderCreated.v1:${factId}`, factId, deliveryCount: 1 };

    const answer = await draftInvoiceOnCreatedHandler(body, meta);

    expect(answer).toBeUndefined();
    expect(draftsOf(CALLED_ORDER_ID)).toEqual([{ orderId: CALLED_ORDER_ID, total }]);
  });
});
