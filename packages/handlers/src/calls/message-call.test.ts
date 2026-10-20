import {
  defineCommand,
  defineEvent,
  defineSubscription,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { fault, handle, InvalidInputError, success, withReader } from '../index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const statuses = ['pending', 'paid'] as const;

const writtenBody = z.object({ orderId: z.uuid(), status: openEnum(statuses) });

const readBody = z.object({ orderId: z.uuid(), status: openEnumReader(statuses) });

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: writtenBody,
});

const orderPaidV1 = defineEvent({
  name: 'OrderPaid',
  version: 1,
  visibility: 'internal',
  description: 'An order was paid',
  body: writtenBody,
});

const notifyOnPaid = defineSubscription({ name: 'notify-on-paid', event: orderPaidV1 });

const paymentSettledV1 = defineEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled, as its Provider’s Contract Package declares it',
  body: readBody,
});

const notifyOnSettled = defineSubscription({ name: 'notify-on-settled', event: paymentSettledV1 });

const chargeCard = withReader(chargeCardV1, readBody);
const notifyOnPaidReader = withReader(notifyOnPaid, readBody);
const notifyOnSettledReader = withReader(notifyOnSettled, notifyOnSettled.event.body);

const meta = { messageId: 'ChargeCard.v1:o-1', factId: 'o-1', deliveryCount: 1 };

const body = { orderId: ORDER_ID, status: 'paid' } as const;

function receiving() {
  const received: unknown[] = [];
  const chargeCardHandler = handle(chargeCard, (given, givenMeta) => {
    received.push(given, givenMeta);
  });
  return { received, chargeCardHandler };
}

async function issuesOf(call: Promise<unknown>): Promise<unknown> {
  const error = await call.then(
    () => undefined,
    (e: unknown) => e,
  );
  return error instanceof InvalidInputError ? error.issues : error;
}

describe("a Message Handler's body", () => {
  test('the implementation receives the body as a Subscriber reads it, unknown keys stripped', async () => {
    const { received, chargeCardHandler } = receiving();

    await chargeCardHandler({ ...body, extra: 'dropped' } as never, meta);

    expect(received[0]).toEqual(body);
  });

  test('an Unknown case written { unknown } reaches the implementation as written', async () => {
    const { received, chargeCardHandler } = receiving();

    await chargeCardHandler({ orderId: ORDER_ID, status: { unknown: 'refunded' } }, meta);

    expect(received[0]).toEqual({ orderId: ORDER_ID, status: { unknown: 'refunded' } });
  });

  test('a declared value written as its writer writes it reaches the implementation unchanged', async () => {
    const { received, chargeCardHandler } = receiving();
    const written: z.output<typeof writtenBody> = { orderId: ORDER_ID, status: 'pending' };

    await chargeCardHandler(written, meta);

    expect(received[0]).toEqual(written);
  });

  test('a bare value an Open Enum does not declare throws InvalidInputError, as its reader refuses it', async () => {
    const { chargeCardHandler } = receiving();

    const call = chargeCardHandler({ orderId: ORDER_ID, status: 'refunded' } as never, meta);

    await expect(issuesOf(call)).resolves.toMatchObject([{ part: 'body', path: ['status'] }]);
  });

  test('an Unknown case holding a declared value throws InvalidInputError', async () => {
    const { chargeCardHandler } = receiving();

    const call = chargeCardHandler({ orderId: ORDER_ID, status: { unknown: 'paid' } }, meta);

    await expect(issuesOf(call)).resolves.toMatchObject([{ part: 'body', path: ['status'] }]);
  });

  test('a body that breaks a constraint throws InvalidInputError at part body, one Issue per failure', async () => {
    const { received, chargeCardHandler } = receiving();

    const call = chargeCardHandler({ orderId: 'nope', status: 7 } as never, meta);

    await expect(issuesOf(call)).resolves.toEqual([
      { part: 'body', path: ['orderId'], code: 'invalid_format', message: expect.any(String) },
      { part: 'body', path: ['status'], code: 'invalid_value', message: expect.any(String) },
    ]);
    expect(received).toEqual([]);
  });

  test('the error message names a Command as ChargeCard@1 and a Subscription by its name, never the received value', async () => {
    const invalid = { orderId: 'secret-value', status: 'paid' } as const;
    const notifyOnSettledHandler = handle(notifyOnSettledReader, () => undefined);

    const messages = [
      await handle
        .stub(chargeCard)(invalid, meta)
        .catch((e: Error) => e.message),
      await notifyOnSettledHandler(invalid, meta).catch((e: Error) => e.message),
    ];

    expect(messages).toEqual([
      expect.stringMatching(/^ChargeCard@1: body\.orderId invalid_format: /),
      expect.stringMatching(/^notify-on-settled: body\.orderId invalid_format: /),
    ]);
    expect(messages.join('\n')).not.toContain('secret-value');
  });

  test("a Subscription to the Service's own Event reads with its paired Reader, not the Event's declared schema", async () => {
    const received: unknown[] = [];
    const notifyOnPaidHandler = handle(notifyOnPaidReader, (given) => {
      received.push(given);
    });

    await notifyOnPaidHandler({ orderId: ORDER_ID, status: { unknown: 'refunded' } }, meta);

    expect(received).toEqual([{ orderId: ORDER_ID, status: { unknown: 'refunded' } }]);
  });

  test("a Subscription to a Dependency's Event reads with that Event's body", async () => {
    const received: unknown[] = [];
    const notifyOnSettledHandler = handle(notifyOnSettledReader, (given) => {
      received.push(given);
    });

    await notifyOnSettledHandler({ orderId: ORDER_ID, status: { unknown: 'refunded' } }, meta);

    expect(received).toEqual([{ orderId: ORDER_ID, status: { unknown: 'refunded' } }]);
  });

  test('a throw while reading the body is rethrown', async () => {
    const error = new Error('getter broke');
    const { chargeCardHandler } = receiving();
    const throwing = {
      status: 'paid',
      get orderId(): string {
        throw error;
      },
    } as const;

    const call = chargeCardHandler(throwing, meta);

    await expect(call).rejects.toBe(error);
  });
});

describe("a Message Handler's meta", () => {
  test('the implementation receives the meta given, headers defaulting to {}', async () => {
    const { received, chargeCardHandler } = receiving();

    await chargeCardHandler(body, meta);

    expect(received[1]).toEqual({ ...meta, headers: {} });
  });

  test('headers given reach the implementation as given', async () => {
    const { received, chargeCardHandler } = receiving();
    const headers = { traceparent: '00-abc-def-01' };

    await chargeCardHandler(body, { ...meta, headers });

    expect(received[1]).toEqual({ ...meta, headers });
  });
});

describe("what a Message Handler's direct call answers", () => {
  test('a Handler that returns nothing answers undefined', async () => {
    const chargeCardHandler = handle(chargeCard, async () => {});

    const answer = await chargeCardHandler(body, meta);

    expect(answer).toBeUndefined();
  });

  test('a Fault the Handler returns comes back unchanged, its cause included', async () => {
    const returned = fault({ committed: 'no', retryable: true, cause: new Error('gateway down') });
    const chargeCardHandler = handle(chargeCard, () => returned);

    const answer = await chargeCardHandler(body, meta);

    expect(answer).toBe(returned);
  });

  test('what the Handler throws is rethrown, the same error', async () => {
    const error = new Error('gateway down');
    const chargeCardHandler = handle(chargeCard, () => {
      throw error;
    });

    const call = chargeCardHandler(body, meta);

    await expect(call).rejects.toBe(error);
  });

  test('a Handler that returns something other than a Fault throws a TypeError naming what came back', async () => {
    const chargeCardHandler = handle(chargeCard, () => success() as never);

    const call = chargeCardHandler(body, meta);

    await expect(call).rejects.toEqual(
      new TypeError("ChargeCard@1's Handler returned no Fault but the kind success"),
    );
  });
});

describe('a Message Handler stub', () => {
  test('a stub given a valid body throws, since consume never runs it', async () => {
    const stub = handle.stub(notifyOnSettledReader);

    const call = stub(body, meta);

    await expect(call).rejects.toEqual(
      new Error("notify-on-settled's Handler is a stub, which consume never runs"),
    );
  });

  test('a stub given a body that breaks the Contract throws InvalidInputError first', async () => {
    const stub = handle.stub(chargeCard);

    const call = stub({ orderId: 'nope', status: 'paid' }, meta);

    await expect(call).rejects.toBeInstanceOf(InvalidInputError);
  });
});
