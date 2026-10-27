import { defineEndpoint, defineGuard, defineRejection } from '@cf-loom/contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { admit, handle, reject, success } from '../index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';
const broken = new Error('getter broke');

/** An entity whose `id` throws when read, as an ORM row may. */
function entityThatThrows(): { readonly id: string } {
  return Object.defineProperty({ id: '' }, 'id', {
    enumerable: true,
    get(): string {
      throw broken;
    },
  });
}

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'Locked',
  body: z.object({ id: z.string() }),
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'An order',
  input: { body: z.object({ id: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
  rejections: [orderLocked],
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  context: z.object({ id: z.string() }),
});

const fromTheThrow = {
  kind: 'fault',
  committed: 'unknown',
  retryable: false,
  message: 'Internal error',
  cause: broken,
};

describe('a direct call never throws what a check throws', () => {
  test('a Success body whose getter throws answers the Fault, the error as cause', async () => {
    const getOrderHandler = handle(getOrder, () => success(entityThatThrows()));

    const outcome = await getOrderHandler({ body: { id: ORDER_ID } }, {});

    expect(outcome).toEqual(fromTheThrow);
  });

  test('a Rejection body whose getter throws answers the Fault', async () => {
    const getOrderHandler = handle(getOrder, () => reject(orderLocked, entityThatThrows()));

    const outcome = await getOrderHandler({ body: { id: ORDER_ID } }, {});

    expect(outcome).toEqual(fromTheThrow);
  });

  test('an admitted Context whose getter throws answers the Fault', async () => {
    const apiKeyHandler = handle(apiKey, () => admit(entityThatThrows()));

    const admission = await apiKeyHandler({}, {});

    expect(admission).toEqual(fromTheThrow);
  });

  test('Input whose getter throws answers the Fault, not committed since nothing ran', async () => {
    const getOrderHandler = handle(getOrder, () => success({ id: ORDER_ID }));

    const outcome = await getOrderHandler({ body: entityThatThrows() }, {});

    expect(outcome).toEqual({ ...fromTheThrow, committed: 'no' });
  });
});
