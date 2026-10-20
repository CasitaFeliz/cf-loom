import { defineEndpoint, defineRejection, notFound, notImplemented } from '@cf-loom/contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { handle, isRejectionOf, reject } from '../index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const outOfStock = defineRejection({
  code: 'OUT_OF_STOCK',
  status: 422,
  message: 'Not enough stock',
  body: z.object({ sku: z.string() }),
});

const updateOrder = defineEndpoint({
  name: 'updateOrder',
  method: 'PUT',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Changes an order',
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 204 },
  rejections: [notFound, orderLocked, outOfStock],
});

const input = { params: { orderId: ORDER_ID } };
const lockedAt = '2026-10-18T10:00:00Z';

describe('isRejectionOf', () => {
  test('a Rejection is told by its declaration, its body typed', async () => {
    const updateOrderHandler = handle(updateOrder, () => reject(orderLocked, { lockedAt }));

    const outcome = await updateOrderHandler(input, {});

    expect(isRejectionOf(outcome, orderLocked) && outcome.body).toEqual({ lockedAt });
    expect(isRejectionOf(outcome, outOfStock)).toBe(false);
    if (isRejectionOf(outcome, orderLocked)) {
      expectTypeOf(outcome.body).toEqualTypeOf<{ lockedAt: string }>();
    }
  });

  test('a Standard Rejection is told by its declaration too', async () => {
    const stub = handle.stub(updateOrder);

    const outcome = await stub(input, {});

    expect([isRejectionOf(outcome, notImplemented), isRejectionOf(outcome, notFound)]).toEqual([
      true,
      false,
    ]);
  });
});

describe('a resolved Rejection’s code', () => {
  test('a declared Rejection’s code, status and message are typed as written', async () => {
    const updateOrderHandler = handle(updateOrder, () => reject(outOfStock, { sku: 'a-1' }));

    const outcome = await updateOrderHandler(input, {});

    expect(isRejectionOf(outcome, outOfStock) && outcome.code).toBe('OUT_OF_STOCK');
    if (isRejectionOf(outcome, outOfStock)) {
      expectTypeOf(outcome.code).toEqualTypeOf<'OUT_OF_STOCK'>();
      expectTypeOf(outcome.status).toEqualTypeOf<422>();
      expectTypeOf(outcome.message).toEqualTypeOf<'Not enough stock'>();
    }
    if (isRejectionOf(outcome, notFound)) {
      expectTypeOf(outcome.code).toEqualTypeOf<string>();
    }
  });

  test('comparing the code leaves out the other declared Rejections', async () => {
    const updateOrderHandler = handle(updateOrder, () => reject(orderLocked, { lockedAt }));

    const outcome = await updateOrderHandler(input, {});

    expect(outcome.kind === 'rejection' && outcome.code).toBe('ORDER_LOCKED');
    if (outcome.kind === 'rejection' && outcome.code === 'ORDER_LOCKED') {
      expectTypeOf(outcome.rejection).not.toEqualTypeOf<typeof outOfStock>();
      expectTypeOf<Extract<typeof outcome, { readonly body: unknown }>['body']>().toEqualTypeOf<{
        lockedAt: string;
      }>();
    }
  });
});
