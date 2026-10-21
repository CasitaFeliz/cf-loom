import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEvent,
  defineSubscription,
  openEnumReader,
} from '@cf-loom/contract';
import { handle, withReader } from '@cf-loom/handlers';
import { messaging } from '@cf-loom/messaging';
import { memory } from '@cf-loom/messaging/memory';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { FakeProviderError, fakeEvent } from './index.ts';

const PAYMENT_ID = '0b5e1c9a-52f7-4c63-9a0e-3d8f2b7a1c44';

/** A Dependency's Event as its Provider's Contract Package exports it: its body a Reader schema. */
const paymentSettledV1 = defineEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({
    paymentId: z.uuid(),
    amount: z.int().positive(),
    status: openEnumReader(['settled', 'refunded']),
  }),
});

const payments = {
  name: 'payments-service',
  version: '5.1.0',
  endpoints: {},
  events: { paymentSettledV1 },
  standardRejections: {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

const paymentsDeps = defineDependencies(payments, { events: [paymentSettledV1] });

const settledEvent = paymentsDeps.events.paymentSettledV1;

const notifyOnSettled = defineSubscription({ name: 'notify-on-settled', event: settledEvent });

const contract = defineContract({
  name: 'orders-service',
  subscriptions: [notifyOnSettled],
  dependencies: [paymentsDeps],
});

const meta = { messageId: 'PaymentSettled.v1:pay-1', factId: 'pay-1', deliveryCount: 1 };

/** The Subscription's Handler, keeping every body it receives. */
function aNotifier() {
  const received: unknown[] = [];
  const handler = handle(withReader(notifyOnSettled, settledEvent.body), (body) => {
    received.push(body);
    return undefined;
  });
  return { handler, received };
}

const secret = 'secret-id-12345';

/** A body that breaks two constraints, the first holding a value no message may show. */
const brokenBody = { paymentId: secret, amount: -1, status: 'settled' } as const;

/** What a mistake's message says, one line at a time. */
function messageLinesOf(error: unknown): string[] {
  return String((error as Error).message).split('\n');
}

/** What a call throws, or undefined when it returns. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('fakeEvent', () => {
  test('a body written as a Subscriber reads it comes back as the Subscriber reads it', () => {
    const body = { paymentId: PAYMENT_ID, amount: 1200, status: 'settled' } as const;

    const faked = fakeEvent(settledEvent, body);

    expect(faked).toEqual(body);
  });

  test('a field the Event does not declare is left out, as every Reader strips it', () => {
    const given = {
      paymentId: PAYMENT_ID,
      amount: 1200,
      status: 'settled',
      note: 'ignored',
    } as const;

    const faked = fakeEvent(settledEvent, given);

    expect(faked).toEqual({ paymentId: PAYMENT_ID, amount: 1200, status: 'settled' });
  });

  test('fakeEvent leaves the given body unchanged and returns a new value', () => {
    const given = { paymentId: PAYMENT_ID, amount: 1200, status: 'settled', note: 'kept' } as const;

    const faked = fakeEvent(settledEvent, given);

    expect(faked).not.toBe(given);
    expect(given).toEqual({ paymentId: PAYMENT_ID, amount: 1200, status: 'settled', note: 'kept' });
  });

  test('an Unknown case { unknown: … } comes back as the Subscriber reads it', () => {
    const faked = fakeEvent(settledEvent, {
      paymentId: PAYMENT_ID,
      amount: 1200,
      status: { unknown: 'disputed' },
    });

    expect(faked.status).toEqual({ unknown: 'disputed' });
  });

  test('a bare undeclared value where an Open Enum is declared is a mistake: an unknown value is { unknown }', () => {
    const faking = () =>
      fakeEvent(settledEvent, {
        paymentId: PAYMENT_ID,
        amount: 1200,
        // @ts-expect-error a value the Open Enum does not declare is written as its Unknown case
        status: 'disputed',
      });

    expect(faking).toThrow(FakeProviderError);
    expect(faking).toThrow(/body at status: invalid_value/);
  });

  test('an Unknown case holding a declared value is a mistake', () => {
    const faking = () =>
      fakeEvent(settledEvent, {
        paymentId: PAYMENT_ID,
        amount: 1200,
        status: { unknown: 'settled' },
      });

    expect(faking).toThrow(FakeProviderError);
    expect(faking).toThrow(/body at status: invalid_value: A declared value, not an Unknown case/);
  });

  test('a body that breaks a constraint throws FakeProviderError naming the Message Version', () => {
    const error = thrownBy(() => fakeEvent(settledEvent, brokenBody));

    expect(error).toBeInstanceOf(FakeProviderError);
    expect(messageLinesOf(error)[0]).toBe('PaymentSettled@1: the faked body breaks its Reader');
  });

  test('each Issue of a body that breaks its constraints sits at body on its own line', () => {
    const error = thrownBy(() => fakeEvent(settledEvent, brokenBody));

    expect(messageLinesOf(error).slice(1)).toEqual([
      expect.stringMatching(/^ {2}body at paymentId: invalid_format: /),
      expect.stringMatching(/^ {2}body at amount: too_small: /),
    ]);
  });

  test('the message of a body that breaks a constraint never holds the value', () => {
    const error = thrownBy(() => fakeEvent(settledEvent, brokenBody));

    expect(messageLinesOf(error).join('\n')).not.toContain(secret);
  });

  test('a missing field is a mistake with the required code', () => {
    // @ts-expect-error the amount is declared, so the body must hold it
    const faking = () => fakeEvent(settledEvent, { paymentId: PAYMENT_ID, status: 'settled' });

    expect(faking).toThrow(/body at amount: required: /);
  });

  test('what throws while the body is read is kept as the mistake’s cause', () => {
    const thrown = new Error('boom');
    const given = {
      get paymentId(): string {
        throw thrown;
      },
      amount: 1200,
      status: 'settled',
    } as const;

    const error = thrownBy(() => fakeEvent(settledEvent, given));

    expect(error).toBeInstanceOf(FakeProviderError);
    expect(error).toMatchObject({
      message: 'PaymentSettled@1: the faked body cannot be read',
      cause: thrown,
    });
  });

  test('the faked body reaches a Subscription’s Handler through a direct call as fakeEvent built it', async () => {
    const { handler, received } = aNotifier();
    const given = { paymentId: PAYMENT_ID, amount: 1200, status: { unknown: 'disputed' } } as const;
    const faked = fakeEvent(settledEvent, given);

    const answer = await handler(faked, meta);

    expect(answer).toBeUndefined();
    expect(received).toEqual([faked]);
  });

  test('the faked body delivered through memory() reaches the Subscription’s Handler as fakeEvent built it, and deliver resolves acked', async () => {
    const { handler, received } = aNotifier();
    const broker = memory();
    const running = await messaging(contract, broker);
    await running.consume({ commands: {}, subscriptions: { 'notify-on-settled': handler } });
    const faked = fakeEvent(settledEvent, {
      paymentId: PAYMENT_ID,
      amount: 1200,
      status: { unknown: 'disputed' },
    });

    const settlement = await broker.deliver(settledEvent, faked, { factId: 'pay-1' });
    await running.close();

    expect(settlement).toBe('acked');
    expect(received).toEqual([faked]);
  });
});
