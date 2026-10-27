import { type MemoryMessaging, memory } from '@cf-loom/messaging/memory';
import { orderCreatedEventV1 } from '@org/contract-orders-service';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import draftInvoiceOnCreatedHandler from '../src/billing/draft-invoice-on-created.handler.ts';
import { draftsOf } from '../src/billing/drafts.ts';
import { contract } from '../src/contract/index.ts';
import handlers from '../src/generated/handlers.generated.ts';

const DELIVERED_ORDER_ID = 'a1f0c3d2-5b4e-4c6a-9d8e-7f6a5b4c3d2e';
const REPEATED_ORDER_ID = 'b2e1d4c3-6a5f-4d7b-8e9f-0a1b2c3d4e5f';
const CALLED_ORDER_ID = 'c3d2e5f4-7b6a-4e8c-9f0a-1b2c3d4e5f60';
const CUSTOMER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const orderCreated = orderCreatedEventV1;
const total = { amount: 1500, currency: 'EUR' };

/** An OrderCreated body as a Subscriber reads it. */
function anOrderCreated(orderId: string) {
  return { orderId, customerId: CUSTOMER_ID, total };
}

describe('draftInvoiceOnCreated over memory()', () => {
  let running: MemoryMessaging<typeof contract>;

  beforeEach(async () => {
    running = await memory(contract);
    await running.consume(handlers, {});
  });

  afterEach(async () => {
    await running.close();
  });

  test('an OrderCreated delivered through memory() is acknowledged and drafts an invoice for the order’s total', async () => {
    const body = anOrderCreated(DELIVERED_ORDER_ID);

    const settlement = await running.deliver(orderCreated, body);

    expect(settlement).toBe('acked');
    expect(draftsOf(DELIVERED_ORDER_ID)).toEqual([{ orderId: DELIVERED_ORDER_ID, total }]);
  });

  test('an OrderCreated delivered twice for the same fact drafts one invoice', async () => {
    const body = anOrderCreated(REPEATED_ORDER_ID);
    const meta = { factId: `${REPEATED_ORDER_ID}:created` };

    await running.deliver(orderCreated, body, meta);
    await running.deliver(orderCreated, body, meta);

    expect(draftsOf(REPEATED_ORDER_ID)).toEqual([{ orderId: REPEATED_ORDER_ID, total }]);
  });
});

describe('draftInvoiceOnCreated called directly', () => {
  test('with an OrderCreated as a Subscriber reads it, the Handler drafts the invoice', async () => {
    const body = anOrderCreated(CALLED_ORDER_ID);

    const answer = await draftInvoiceOnCreatedHandler(body);

    expect(answer).toBeUndefined();
    expect(draftsOf(CALLED_ORDER_ID)).toEqual([{ orderId: CALLED_ORDER_ID, total }]);
  });
});
