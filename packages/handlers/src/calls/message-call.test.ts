import {
  defineCommand,
  defineEvent,
  defineSubscription,
  openEnum,
  openEnumReader,
  providedEvent,
} from '@cf-loom/contract';
import { brokerMessageIdOf } from '@cf-loom/contract/internal';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import {
  type Fault,
  fault,
  handle,
  InvalidInputError,
  type MessageFault,
  readersOf,
  success,
  type WithResources,
} from '../index.ts';

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

const notifyOnPaid = defineSubscription({
  name: 'notifyOnPaid',
  description: 'Notify on paid',
  event: orderPaidV1,
});

const paymentSettledV1 = providedEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled, as its Provider’s Contract Package declares it',
  body: readBody,
});

const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notify on settled',
  event: paymentSettledV1,
});

const readers = readersOf({
  commands: { chargeCardV1: { element: chargeCardV1, reader: readBody } },
  subscriptions: {
    notifyOnPaid: { element: notifyOnPaid, reader: readBody },
    notifyOnSettled: { element: notifyOnSettled, reader: notifyOnSettled.event.body },
  },
});

const chargeCard = readers.commands.chargeCardV1;
const notifyOnPaidReader = readers.subscriptions.notifyOnPaid;
const notifyOnSettledReader = readers.subscriptions.notifyOnSettled;

const tree: z.ZodType = z.object({
  get next() {
    return tree.optional();
  },
});

const nestV1 = defineCommand({
  name: 'Nest',
  version: 1,
  description: 'A deep body',
  body: tree,
});

const nesting = readersOf({
  commands: { nestV1: { element: nestV1, reader: tree } },
  subscriptions: {},
}).commands.nestV1;

const meta = { messageId: 'command.ChargeCard.v1:o-1', factId: 'o-1', deliveryCount: 1 };

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

describe("a Message Handler's Resources", () => {
  type Notifications = { readonly send: (orderId: string) => void };
  type NotificationsTaken = { readonly notifications: Notifications };

  test("a CommandHandler's and an EventHandler's implementation receive the Resources their direct call is given", async () => {
    const resources = { notifications: { send: () => undefined } };
    const received: unknown[] = [];
    const chargeCardHandler = handle(
      chargeCard,
      (_body, _meta, { resources }: WithResources<NotificationsTaken>) => {
        received.push(resources);
      },
    );
    const notifyOnPaidHandler = handle(
      notifyOnPaidReader,
      (_body, _meta, { resources }: WithResources<NotificationsTaken>) => {
        received.push(resources);
      },
    );

    await chargeCardHandler(body, meta, { resources });
    await notifyOnPaidHandler(body, meta, { resources });

    expect(received).toHaveLength(2);
    expect(received[0]).toBe(resources);
    expect(received[1]).toBe(resources);
  });
});

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
      expect.stringMatching(/^notifyOnSettled: body\.orderId invalid_format: /),
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

  test("a Subscription to a Provider's Event reads with that Event's body", async () => {
    const received: unknown[] = [];
    const notifyOnSettledHandler = handle(notifyOnSettledReader, (given) => {
      received.push(given);
    });

    await notifyOnSettledHandler({ orderId: ORDER_ID, status: { unknown: 'refunded' } }, meta);

    expect(received).toEqual([{ orderId: ORDER_ID, status: { unknown: 'refunded' } }]);
  });

  test('a body nested past the stack throws InvalidInputError at body, and the implementation never runs', async () => {
    let deep: object = {};
    for (let depth = 0; depth < 5000; depth += 1) {
      deep = { next: deep };
    }
    const received: unknown[] = [];
    const nestHandler = handle(nesting, (given) => {
      received.push(given);
    });

    const issues = await issuesOf(nestHandler(deep, meta));

    expect(issues).toEqual([
      {
        part: 'body',
        path: [],
        code: 'malformed',
        message: 'The value is nested too deeply to read',
      },
    ]);
    expect(received).toEqual([]);
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

    expect(received[1]).toEqual({
      ...meta,
      lastAttempt: false,
      headers: {},
      signal: expect.any(AbortSignal),
    });
  });

  test('two direct calls without headers each give the implementation its own headers', async () => {
    const { received, chargeCardHandler } = receiving();

    await chargeCardHandler(body, meta);
    await chargeCardHandler(body, meta);

    const [first, second] = [received[1], received[3]] as { headers: object }[];
    expect(first?.headers).not.toBe(second?.headers);
  });

  test('headers given reach the implementation as given', async () => {
    const { received, chargeCardHandler } = receiving();
    const headers = { traceparent: '00-abc-def-01' };

    await chargeCardHandler(body, { ...meta, headers });

    expect(received[1]).toEqual({
      ...meta,
      lastAttempt: false,
      headers,
      signal: expect.any(AbortSignal),
    });
  });
});

describe("a Message Handler's meta, left out", () => {
  function receivingEvents() {
    const received: unknown[] = [];
    const notifyOnPaidHandler = handle(notifyOnPaidReader, (_given, givenMeta) => {
      received.push(givenMeta);
    });
    return { received, notifyOnPaidHandler };
  }

  test('a direct EventHandler call with no meta gives attempt 1, not the last, and no headers', async () => {
    const { received, notifyOnPaidHandler } = receivingEvents();

    await notifyOnPaidHandler(body);

    expect(received[0]).toMatchObject({ deliveryCount: 1, lastAttempt: false, headers: {} });
  });

  test('a direct call given only a Fact id gives the broker message id deliver derives from it', async () => {
    const { received, notifyOnPaidHandler } = receivingEvents();

    await notifyOnPaidHandler(body, { factId: 'f-1' });

    const messageId = brokerMessageIdOf(orderPaidV1, 'f-1');
    expect(received[0]).toMatchObject({ factId: 'f-1', messageId });
  });

  test('two direct calls with no Fact id each get a different one', async () => {
    const { received, notifyOnPaidHandler } = receivingEvents();

    await notifyOnPaidHandler(body);
    await notifyOnPaidHandler(body);

    const [first, second] = received as { factId: string }[];
    expect(first?.factId).not.toBe(second?.factId);
  });

  test("a direct CommandHandler call's derived broker message id names its Command's Message Version", async () => {
    const { received, chargeCardHandler } = receiving();

    await chargeCardHandler(body, { factId: 'f-1' });

    expect(received[1]).toMatchObject({ messageId: 'command.ChargeCard.v1:f-1' });
  });

  test('the meta may be left out unless Resources are required, which the call then gives after it', () => {
    type Taken = { readonly notifications: { readonly send: () => void } };
    const plain = handle(chargeCard, () => undefined);
    const withResources = handle(chargeCard, (_body, _meta, _last: WithResources<Taken>) => {
      return undefined;
    });
    const resources = { notifications: { send: () => undefined } };

    expectTypeOf(plain).toBeCallableWith(body);
    expectTypeOf(plain).toBeCallableWith(body, { factId: 'f-1' });
    // @ts-expect-error Resources required are given after the meta
    const missing = () => withResources(body);
    expectTypeOf(withResources).toBeCallableWith(body, {}, { resources });
    expect(missing).toBeTypeOf('function');
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

  test('a Message Handler may return a retryable Fault, but not one with retryAfter', () => {
    const later = fault({ committed: 'no', retryable: true, retryAfter: 5 });
    const retryable = handle(chargeCard, () => fault({ committed: 'no', retryable: true }));
    // @ts-expect-error the durable consumer's configuration decides when the Message comes again
    const timed = handle(chargeCard, () => later);

    expect([typeof retryable, typeof timed]).toEqual(['function', 'function']);
  });

  test('a helper typed MessageFault serves a Message Handler, and one typed Fault does not', () => {
    function unavailable(): MessageFault {
      return fault({ committed: 'no', retryable: true });
    }

    const helped = handle(chargeCard, async (): Promise<MessageFault | undefined> => unavailable());
    // @ts-expect-error a Message Handler's Fault is a MessageFault, with no retryAfter
    const typedFault = handle(chargeCard, async (): Promise<Fault | undefined> => undefined);

    expect([typeof helped, typeof typedFault]).toEqual(['function', 'function']);
  });

  test('what the Handler throws is rethrown, the same error', async () => {
    const error = new Error('gateway down');
    const chargeCardHandler = handle(chargeCard, () => {
      throw error;
    });

    const call = chargeCardHandler(body, meta);

    await expect(call).rejects.toBe(error);
  });

  test('a value the Handler throws that is no Error is rethrown as it is', async () => {
    const chargeCardHandler = handle(chargeCard, () => {
      throw 'gateway down';
    });

    const call = chargeCardHandler(body, meta);

    await expect(call).rejects.toBe('gateway down');
  });

  test('a Handler that returns the fields of a Fault without its kind throws a TypeError', async () => {
    const lookalike = { committed: 'no', retryable: true, message: 'x' };
    const chargeCardHandler = handle(chargeCard, () => lookalike as never);

    const call = chargeCardHandler(body, meta);

    await expect(call).rejects.toEqual(
      new TypeError("ChargeCard@1's Handler returned no Fault but object"),
    );
  });

  test('a Handler that returns the fields of a Fault under another kind throws a TypeError', async () => {
    const lookalike = { kind: 'success', committed: 'no', retryable: true, message: 'x' };
    const chargeCardHandler = handle(chargeCard, () => lookalike as never);

    const call = chargeCardHandler(body, meta);

    await expect(call).rejects.toEqual(
      new TypeError("ChargeCard@1's Handler returned no Fault but the kind success"),
    );
  });

  test('a Handler that returns null throws a TypeError naming null', async () => {
    const chargeCardHandler = handle(chargeCard, () => null as never);

    const call = chargeCardHandler(body, meta);

    await expect(call).rejects.toEqual(
      new TypeError("ChargeCard@1's Handler returned no Fault but null"),
    );
  });

  test('an EventHandler that returns something other than a Fault throws a TypeError naming no Fault', async () => {
    const notifyOnSettledHandler = handle(notifyOnSettledReader, () => success() as never);

    const call = notifyOnSettledHandler(body, meta);

    await expect(call).rejects.toEqual(
      new TypeError("notifyOnSettled's Handler returned no Fault but the kind success"),
    );
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
      new Error("notifyOnSettled's Handler is a stub, which consume never runs"),
    );
  });

  test('a stub given a body that breaks the Contract throws InvalidInputError first', async () => {
    const stub = handle.stub(chargeCard);

    const call = stub({ orderId: 'nope', status: 'paid' }, meta);

    await expect(call).rejects.toBeInstanceOf(InvalidInputError);
  });
});
