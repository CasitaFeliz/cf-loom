import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  openEnum,
  openEnumReader,
  providedEvent,
} from '@cf-loom/contract';
import {
  fault,
  handle,
  InvalidInputError,
  type MessageFault,
  type MessageMeta,
  readersOf,
} from '@cf-loom/handlers';
import { afterEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { z } from 'zod';
import { type ConsumedFault, InvalidMessageError } from '../index.ts';
import { type MemoryMessaging, memory } from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const PAYMENT_ID = '0b5e1c9a-52f7-4c63-9a0e-3d8f2b7a1c44';

const statuses = ['pending', 'paid'] as const;

const orderBody = z.object({ orderId: z.uuid() });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  lifecycle: 'deprecated',
  description: 'An order was created',
  body: orderBody,
});

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was created, with its status',
  body: z.object({ orderId: z.uuid(), status: openEnum(statuses) }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: orderBody,
});

const refundV1 = defineCommand({
  name: 'Refund',
  version: 1,
  lifecycle: 'retired',
  description: 'Refunds the order',
  body: orderBody,
});

const paymentSettledV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid(), status: openEnumReader(statuses) }),
});

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV2,
});

const auditCreated = defineSubscription({
  name: 'auditCreated',
  description: 'Audit created',
  event: orderCreatedV2,
});

const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notify on settled',
  event: paymentSettledV1,
});

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1, orderCreatedV2],
      commands: [chargeCardV1, refundV1],
      subscriptions: [notifyOnCreated, auditCreated, notifyOnSettled],
    }),
  ],
});

const readerV2 = z.object({ orderId: z.string(), status: openEnumReader(statuses) });

const readers = readersOf({
  commands: { chargeCardV1: { declaration: chargeCardV1, reader: orderBody } },
  subscriptions: {
    notifyOnCreated: { declaration: notifyOnCreated, reader: readerV2 },
    auditCreated: {
      declaration: auditCreated,
      reader: z.object({ orderId: z.uuid(), status: readerV2.shape.status }),
    },
    notifyOnSettled: { declaration: notifyOnSettled, reader: paymentSettledV1.body },
  },
});

type Received = { readonly handler: string; readonly body: unknown; readonly meta: MessageMeta };

type Implementation = (
  body: unknown,
  meta: MessageMeta,
) => MessageFault | undefined | Promise<MessageFault | undefined>;

type Handlers = {
  readonly charge?: Implementation;
  readonly notify?: Implementation;
  readonly audit?: Implementation;
  readonly settled?: Implementation;
};

/** A memory() of the Contract, also destructured, with what its Handlers received and its Service's faults. */
type Running = MemoryMessaging<typeof contract> & {
  readonly inMemory: MemoryMessaging<typeof contract>;
  readonly received: Received[];
  readonly faults: ConsumedFault[];
};

/** A Handler implementation that keeps what it receives under its name, then answers as given. */
function recording(
  received: Received[],
  handler: string,
  answer: Implementation = () => undefined,
) {
  return (body: unknown, meta: MessageMeta) => {
    received.push({ handler, body, meta });
    return answer(body, meta);
  };
}

/** A memory() connected to the Contract and consuming, every Handler recording what it receives. */
async function running(
  handlers: (connection: Running) => Handlers = () => ({}),
  received: Received[] = [],
): Promise<Running> {
  const faults: ConsumedFault[] = [];
  const inMemory = await memory(contract, {
    onServiceFault: (consumedFault) => {
      faults.push(consumedFault);
    },
  });
  const connection = { inMemory, received, faults, ...inMemory };
  const answers = handlers(connection);
  await inMemory.consume(
    {
      commands: {
        chargeCardV1: handle(
          readers.commands.chargeCardV1,
          recording(received, 'ChargeCard@1', answers.charge),
        ),
      },
      subscriptions: {
        notifyOnCreated: handle(
          readers.subscriptions.notifyOnCreated,
          recording(received, 'notifyOnCreated', answers.notify),
        ),
        auditCreated: handle(
          readers.subscriptions.auditCreated,
          recording(received, 'auditCreated', answers.audit),
        ),
        notifyOnSettled: handle(
          readers.subscriptions.notifyOnSettled,
          recording(received, 'notifyOnSettled', answers.settled),
        ),
      },
      readers,
    },
    {},
  );
  return connection;
}

/** A promise a test settles itself, to hold a Handler while it runs. */
function aGate() {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** What a promise rejected with, or undefined when it resolved. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (e) {
    return e;
  }
}

const boom = new Error('gateway down');

const throwing = (): never => {
  throw boom;
};

const created = { orderId: ORDER_ID, status: 'paid' } as const;

const charge = { orderId: ORDER_ID };

const settledPayment = { paymentId: PAYMENT_ID, status: 'paid' } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deliver()', () => {
  test('deliver writes a Provided Event’s body, as its Reader reads it, back through the Reader, so the Handler reads { unknown } for an undeclared Open Enum value', async () => {
    const { inMemory, received } = await running();
    const refunded = { paymentId: PAYMENT_ID, status: { unknown: 'refunded' } };

    await inMemory.deliver(paymentSettledV1, refunded);

    const notified = received.find(({ handler }) => handler === 'notifyOnSettled');
    expect(notified?.body).toEqual(refunded);
  });

  test.each<[string, Implementation, string]>([
    ['nothing', () => undefined, 'acked'],
    ['a retryable Fault', () => fault({ committed: 'no', retryable: true }), 'pending'],
    ['a throw', throwing, 'pending'],
    ['a non-retryable Fault', () => fault({ committed: 'no', retryable: false }), 'ended'],
  ])(
    'deliver resolves to acked, pending or ended as the Handler settles: %s',
    async (_answer, answer, expected) => {
      const { inMemory } = await running(() => ({ charge: answer }));

      const settlement = await inMemory.deliver(chargeCardV1, charge);

      expect(settlement).toBe(expected);
    },
  );

  test('deliver to a Provider’s Event reaches the Subscription to it', async () => {
    const { inMemory, received } = await running();

    const settlement = await inMemory.deliver(paymentSettledV1, settledPayment);

    expect(settlement).toBe('acked');
    expect(received.map(({ handler, body }) => [handler, body])).toEqual([
      ['notifyOnSettled', settledPayment],
    ]);
  });

  test('deliver to a Command reaches its Message Handler', async () => {
    const { inMemory, received } = await running();

    await inMemory.deliver(chargeCardV1, charge);

    expect(received.map(({ handler, body }) => [handler, body])).toEqual([
      ['ChargeCard@1', charge],
    ]);
  });

  test.each<[Implementation, Implementation, string]>([
    [() => undefined, () => fault({ committed: 'no', retryable: true }), 'pending'],
    [
      () => fault({ committed: 'no', retryable: true }),
      () => fault({ committed: 'no', retryable: false }),
      'ended',
    ],
    [() => fault({ committed: 'no', retryable: false }), () => undefined, 'ended'],
  ])(
    'deliver to an Event two Subscriptions take reaches each and resolves to the most severe settlement',
    async (notify, audit, expected) => {
      const { inMemory, received } = await running(() => ({ notify, audit }));

      const settlement = await inMemory.deliver(orderCreatedV2, created);

      expect(received.map(({ handler }) => handler)).toEqual(['notifyOnCreated', 'auditCreated']);
      expect(settlement).toBe(expected);
    },
  );

  test('deliver to an Event one Subscription leaves pending and close’s signal hands back from the other resolves to pending, the more severe', async () => {
    const handling = Promise.withResolvers<void>();
    const { inMemory, close } = await running(() => ({
      notify: () => fault({ committed: 'no', retryable: true }),
      audit: () => {
        handling.resolve();
        return new Promise(() => undefined);
      },
    }));
    const delivered = inMemory.deliver(orderCreatedV2, created);
    await handling.promise;

    await close({ signal: AbortSignal.abort() }).catch(() => undefined);

    await expect(delivered).resolves.toBe('pending');
  });

  test('the broker message id defaults to command.<Name>.v<n>:<factId>, and meta.messageId replaces it', async () => {
    const { inMemory, received } = await running();

    await inMemory.deliver(chargeCardV1, charge, { factId: 'f-1' });
    await inMemory.deliver(chargeCardV1, charge, { factId: 'f-2', messageId: 'custom-id' });

    expect(received.map(({ meta }) => [meta.messageId, meta.factId])).toEqual([
      ['command.ChargeCard.v1:f-1', 'f-1'],
      ['custom-id', 'f-2'],
    ]);
  });

  test('deliver given a Fact id gives the Handler the broker message id a direct call given it gives', async () => {
    const { inMemory, received } = await running();
    const direct: MessageMeta[] = [];
    const directHandler = handle(readers.subscriptions.notifyOnSettled, (_body, meta) => {
      direct.push(meta);
    });

    await inMemory.deliver(paymentSettledV1, settledPayment, { factId: 'f-1' });
    await directHandler(settledPayment, { factId: 'f-1' });

    expect(received[0]?.meta.messageId).toBe(direct[0]?.messageId);
  });

  test('without a Fact id, deliver uses a random one', async () => {
    const { inMemory, received } = await running();

    await inMemory.deliver(chargeCardV1, charge);
    await inMemory.deliver(chargeCardV1, charge);

    const [first, second] = received.map(({ meta }) => meta);
    expect(first?.factId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first?.messageId).toBe(`command.ChargeCard.v1:${first?.factId}`);
    expect(second?.factId).not.toBe(first?.factId);
  });

  test('meta.headers reach the Handler; without them it receives {}', async () => {
    const { inMemory, received } = await running();
    const headers = { traceparent: '00-abc-def-01' };

    await inMemory.deliver(chargeCardV1, charge, { headers });
    await inMemory.deliver(chargeCardV1, charge);

    expect(received.map(({ meta }) => meta.headers)).toEqual([headers, {}]);
  });

  test.each([
    [
      { 'Nats-Msg-Id': 'x' },
      'The transport header Nats-Msg-Id takes a name cf-loom or NATS reserves: any starting with Cf-Loom- or Nats-',
    ],
    [
      { 'cf-loom-fact-id': 'x' },
      'The transport header cf-loom-fact-id takes a name cf-loom or NATS reserves: any starting with Cf-Loom- or Nats-',
    ],
    [
      { 'nats-expected-stream': 'other' },
      'The transport header nats-expected-stream takes a name cf-loom or NATS reserves: any starting with Cf-Loom- or Nats-',
    ],
    [
      { 'trace id': 'x' },
      'The transport header name "trace id" cannot travel over NATS: it is empty or holds a colon, a space, a control or a non-ASCII character',
    ],
    [
      { 'x-note': 'x ' },
      'The transport header x-note has a value that would not arrive as given over NATS: not a string, a CR or LF, whitespace leading or trailing, or a lone surrogate',
    ],
  ])(
    'the headers %j are refused with InvalidMessageError, and no Handler runs',
    async (headers, message) => {
      const { inMemory, received } = await running();

      const delivering = inMemory.deliver(chargeCardV1, charge, { headers });

      await expect(delivering).rejects.toBeInstanceOf(InvalidMessageError);
      await expect(delivering).rejects.toThrow(message);
      expect(received).toEqual([]);
    },
  );

  test('a bad Fact id and bad headers are all listed in one InvalidMessageError, the Fact id first', async () => {
    const { inMemory, received } = await running();
    const headers = { 'x-a': 'x ', 'Nats-TTL': '1' };

    const rejection = await rejectionOf(
      inMemory.deliver(chargeCardV1, charge, { factId: 'f-1 ', headers }),
    );

    expect(rejection).toMatchObject({
      invalid: [
        { kind: 'id', at: 'factId' },
        { kind: 'header', name: 'x-a', fit: 'uncarried-value' },
        { kind: 'header', name: 'Nats-TTL', fit: 'reserved-name' },
      ],
    });
    expect(received).toEqual([]);
  });

  test.each(['', ' f-1', 'f-1 ', 'f-1\n', 'f-1\uD800'])(
    'deliver refuses a Fact id of %j as publish does, with InvalidMessageError, and no Handler runs',
    async (factId) => {
      const { inMemory, received } = await running();

      const rejection = await rejectionOf(inMemory.deliver(chargeCardV1, charge, { factId }));

      expect(rejection).toBeInstanceOf(InvalidMessageError);
      expect(rejection).toMatchObject({
        message:
          'factId: A Fact id is a non-empty string with no CR or LF, no whitespace leading or trailing and no lone surrogate',
        invalid: [{ kind: 'id', at: 'factId' }],
      });
      expect(received).toEqual([]);
    },
  );

  test.each(['', ' m-1', 'm-1 ', 'm-1\n', 'm-1\uD800'])(
    'deliver refuses a broker message id of %j at messageId, and no Handler runs',
    async (messageId) => {
      const { inMemory, received } = await running();

      const rejection = await rejectionOf(
        inMemory.deliver(chargeCardV1, charge, { factId: 'f-1', messageId }),
      );

      expect(rejection).toBeInstanceOf(InvalidMessageError);
      expect(rejection).toMatchObject({
        message:
          'messageId: A broker message id is a non-empty string with no CR or LF, no whitespace leading or trailing and no lone surrogate',
        invalid: [{ kind: 'id', at: 'messageId' }],
      });
      expect(received).toEqual([]);
    },
  );

  test('a Fact id and transport headers whose broker headers would take more bytes than JetStream stores are refused, naming the Message Version, and no Handler runs', async () => {
    const { inMemory, received } = await running();
    const headers = { 'x-pad': 'p'.repeat(30_000) };

    const delivering = inMemory.deliver(chargeCardV1, charge, {
      factId: 'f'.repeat(20_000),
      headers,
    });

    await expect(delivering).rejects.toThrow(
      'ChargeCard@1: The broker headers would take 70077 bytes, over the 65535 JetStream stores; the Fact id counts twice, in Cf-Loom-Fact-Id and in Nats-Msg-Id',
    );
    expect(received).toEqual([]);
  });

  test('a broker message id given is counted in place of command.<Name>.v<n>:<factId>, so a long one is refused and no Handler runs', async () => {
    const { inMemory, received } = await running();

    const delivering = inMemory.deliver(chargeCardV1, charge, {
      factId: 'f-1',
      messageId: 'm'.repeat(65_500),
    });

    await expect(delivering).rejects.toThrow(
      /^ChargeCard@1: The broker headers would take 65549 bytes, over the 65535 JetStream stores/,
    );
    expect(received).toEqual([]);
  });

  test('broker headers of exactly the bytes JetStream stores are delivered as given', async () => {
    const { inMemory, received } = await running();
    const headers = { 'x-pad': 'p'.repeat(65_452) };

    await inMemory.deliver(chargeCardV1, charge, { factId: 'f-1', headers });

    expect(received.map(({ meta }) => [meta.factId, meta.headers])).toEqual([['f-1', headers]]);
  });

  test('the same fact delivered twice reaches the Handler twice', async () => {
    const { inMemory, received } = await running();

    const settlements = [
      await inMemory.deliver(chargeCardV1, charge, { factId: 'f-1' }),
      await inMemory.deliver(chargeCardV1, charge, { factId: 'f-1' }),
    ];

    expect(settlements).toEqual(['acked', 'acked']);
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 1]);
  });

  test('a body that breaks the Reader rejects deliver with InvalidInputError at body, and no Handler runs, not even a first Subscription’s', async () => {
    const { inMemory, received } = await running();
    const wrong = { orderId: 'not-a-uuid', status: 'paid' } as const;

    const rejection = await rejectionOf(inMemory.deliver(orderCreatedV2, wrong));

    expect(rejection).toBeInstanceOf(InvalidInputError);
    expect(rejection).toMatchObject({
      message: expect.stringContaining('auditCreated'),
      issues: [{ part: 'body', path: ['orderId'], code: 'invalid_format' }],
    });
    expect(received).toEqual([]);
  });

  test('broker headers too large are refused before a body the Reader refuses, and no Handler runs', async () => {
    const { inMemory, received } = await running();
    const wrong = { orderId: 'not-a-uuid' };

    const rejection = await rejectionOf(
      inMemory.deliver(chargeCardV1, wrong, { factId: 'o'.repeat(33_000) }),
    );

    expect(rejection).not.toBeInstanceOf(InvalidInputError);
    expect(rejection).toMatchObject({
      message: expect.stringMatching(/^ChargeCard@1: The broker headers would take 66068 bytes/),
    });
    expect(received).toEqual([]);
  });

  test.each([
    [
      'a stub’s Subscription',
      { declaration: paymentSettledV1, body: settledPayment },
      'PaymentSettled@1',
    ],
    ['a Retired Command', { declaration: refundV1, body: charge }, 'Refund@1'],
  ])(
    'deliver to an Element nothing consumes rejects, naming it: %s',
    async (_which, { declaration, body }, named) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const inMemory = await memory(contract);
      await inMemory.consume(
        {
          commands: { chargeCardV1: handle.stub(readers.commands.chargeCardV1) },
          subscriptions: {
            notifyOnCreated: handle.stub(readers.subscriptions.notifyOnCreated),
            auditCreated: handle.stub(readers.subscriptions.auditCreated),
            notifyOnSettled: handle.stub(readers.subscriptions.notifyOnSettled),
          },
          readers,
        },
        {},
      );

      const delivering = inMemory.deliver(declaration, body);

      await expect(delivering).rejects.toThrow(`${named} has no consumer`);
    },
  );

  test('deliver before consume rejects, naming the Element', async () => {
    const inMemory = await memory(contract);

    const delivering = inMemory.deliver(chargeCardV1, charge);

    await expect(delivering).rejects.toThrow('ChargeCard@1 has no consumer');
  });

  test('deliver stops once its own Messages have settled: what their Handlers send stays lined up, and close() lists it as pending', async () => {
    const charged: string[] = [];
    const { inMemory } = await running((connection) => ({
      notify: async () => {
        await connection.sender.send('ChargeCard', charge, { factId: 'f-1' });
        await connection.sender.send('ChargeCard', charge, { factId: 'f-2' });
        return undefined;
      },
      charge: () => {
        charged.push('charged');
        return undefined;
      },
    }));

    await inMemory.deliver(orderCreatedV2, created);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await inMemory.close();

    expect(charged).toEqual([]);
    expect(inMemory.pending.map(({ messageId }) => messageId)).toEqual([
      'command.ChargeCard.v1:f-1',
      'command.ChargeCard.v1:f-2',
    ]);
  });

  test('deliver waits for the Messages already lined up', async () => {
    const gate = aGate();
    const entered = Promise.withResolvers<void>();
    const log: string[] = [];
    const { inMemory, sender } = await running(() => ({
      charge: async (_body, meta) => {
        log.push(`${meta.factId} starts`);
        entered.resolve();
        await gate.opened;
        log.push(`${meta.factId} ends`);
        return undefined;
      },
    }));
    await sender.send('ChargeCard', charge, { factId: 'sent' });

    const delivering = inMemory.deliver(chargeCardV1, charge, { factId: 'delivered' });
    await entered.promise;
    const whileHeld = [...log];
    gate.open();
    await delivering;

    expect(whileHeld).toEqual(['sent starts']);
    expect(log).toEqual(['sent starts', 'sent ends', 'delivered starts', 'delivered ends']);
  });
});

describe('pending and redeliver()', () => {
  test.each<[string, Implementation]>([
    ['threw', throwing],
    ['returned a retryable Fault', () => fault({ committed: 'no', retryable: true })],
  ])(
    'a Message whose Handler %s is listed with its declaration, its identity, its ids, its attempt and its headers',
    async (_how, answer) => {
      const headers = { traceparent: '00-abc-def-01' };
      const { inMemory } = await running(() => ({ notify: answer }));

      await inMemory.deliver(orderCreatedV2, created, { factId: 'o-1', headers });

      expect(inMemory.pending).toEqual([
        {
          declaration: notifyOnCreated,
          identity: 'notifyOnCreated',
          subject: 'orders-service.event.OrderCreated.v2',
          messageId: 'event.OrderCreated.v2:o-1',
          factId: 'o-1',
          deliveryCount: 1,
          headers,
          body: created,
        },
      ]);
    },
  );

  test('a pending Message’s declaration is the one its fault names', async () => {
    const { inMemory, faults } = await running(() => ({ notify: throwing }));

    await inMemory.deliver(orderCreatedV2, created, { factId: 'o-1' });

    const named = { declaration: notifyOnCreated, identity: 'notifyOnCreated' };
    expect(inMemory.pending).toMatchObject([named]);
    expect(faults).toMatchObject([named]);
  });

  test('an Event two Subscriptions take, one ending it and one acknowledging, makes settled() reject with the one Fault’s line', async () => {
    const ending = () => fault({ committed: 'no', retryable: false, message: 'Not notified' });
    const { inMemory, publisher } = await running(() => ({ notify: ending }));
    await publisher.publish('OrderCreated', { v1: charge, v2: created }, { factId: 'o-1' });

    const rejection = await rejectionOf(inMemory.settled());

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe(
      'notifyOnCreated orders-service.event.OrderCreated.v2 event.OrderCreated.v2:o-1 o-1 attempt 1: Not notified',
    );
  });

  test('a redelivered Message’s fault carries deliveryCount 2', async () => {
    const { inMemory, faults } = await running(() => ({ notify: throwing }));
    await inMemory.deliver(orderCreatedV2, created, { factId: 'o-1' });

    await inMemory.redeliver();

    expect(faults.map(({ deliveryCount }) => deliveryCount)).toEqual([1, 2]);
  });

  test('memory never marks a delivery as the last attempt', async () => {
    const { inMemory, faults, received } = await running(() => ({ notify: throwing }));
    await inMemory.deliver(orderCreatedV2, created, { factId: 'o-1' });

    await inMemory.redeliver();
    await inMemory.redeliver();
    await inMemory.redeliver();

    const notified = received.filter(({ handler }) => handler === 'notifyOnCreated');
    expect(notified.map(({ meta }) => meta.lastAttempt)).toEqual([false, false, false, false]);
    expect(faults.map(({ lastAttempt }) => lastAttempt)).toEqual([false, false, false, false]);
  });

  test('a delivery whose settling rejects rejects deliver with that error, lists nothing pending, and the next delivery runs', async () => {
    const broken = new Error('the console broke');
    const inMemory = await memory(contract);
    await inMemory.consume(
      {
        commands: { chargeCardV1: handle(readers.commands.chargeCardV1, throwing) },
        subscriptions: {
          notifyOnCreated: handle(readers.subscriptions.notifyOnCreated, () => undefined),
          auditCreated: handle(readers.subscriptions.auditCreated, () => undefined),
          notifyOnSettled: handle(readers.subscriptions.notifyOnSettled, () => undefined),
        },
        readers,
      },
      {},
    );
    const logging = vi.spyOn(console, 'error').mockImplementation(() => {
      throw broken;
    });

    const rejection = await rejectionOf(inMemory.deliver(chargeCardV1, charge, { factId: 'f-1' }));
    const pendingAfter = inMemory.pending;
    logging.mockImplementation(() => undefined);
    const next = await inMemory.deliver(chargeCardV1, charge, { factId: 'f-2' });
    const settling = await rejectionOf(inMemory.settled());

    expect(rejection).toBe(broken);
    expect(pendingAfter).toEqual([]);
    expect(next).toBe('pending');
    expect((settling as Error).message).toBe(
      'ChargeCard@1 orders-service.command.ChargeCard.v1 command.ChargeCard.v1:f-2 f-2 attempt 1: the Handler threw',
    );
  });

  test('a delivery a Handler’s publish lined up whose settling rejects reaches the runtime as an unhandled rejection', async () => {
    const broken = new Error('the console broke');
    const unhandled: unknown[] = [];
    const runtimeListeners = process.listeners('unhandledRejection');
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', (reason) => void unhandled.push(reason));
    onTestFinished(() => {
      process.removeAllListeners('unhandledRejection');
      for (const listener of runtimeListeners) {
        process.on('unhandledRejection', listener);
      }
    });
    const inMemory = await memory(contract);
    const { publisher } = inMemory;
    await inMemory.consume(
      {
        commands: {
          chargeCardV1: handle(readers.commands.chargeCardV1, async () => {
            await publisher.publish('OrderCreated', { v1: charge, v2: created }, { factId: 'o-1' });
          }),
        },
        subscriptions: {
          notifyOnCreated: handle(readers.subscriptions.notifyOnCreated, throwing),
          auditCreated: handle(readers.subscriptions.auditCreated, () => undefined),
          notifyOnSettled: handle(readers.subscriptions.notifyOnSettled, () => undefined),
        },
        readers,
      },
      {},
    );
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw broken;
    });

    await inMemory.deliver(chargeCardV1, charge, { factId: 'o-1' });
    await rejectionOf(inMemory.settled());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(unhandled).toEqual([broken]);
  });

  test('pending lists the wire body, not the form the Handler read', async () => {
    const { inMemory, received } = await running(() => ({ settled: throwing }));
    const refunded = { paymentId: PAYMENT_ID, status: { unknown: 'refunded' } };

    await inMemory.deliver(paymentSettledV1, refunded);

    const read = received.find(({ handler }) => handler === 'notifyOnSettled')?.body;
    expect(read).toEqual(refunded);
    expect(inMemory.pending.map(({ body }) => body)).toEqual([
      { paymentId: PAYMENT_ID, status: 'refunded' },
    ]);
  });

  test('pending lists a Command left pending with the Command', async () => {
    const { inMemory } = await running(() => ({ charge: throwing }));

    await inMemory.deliver(chargeCardV1, charge, { factId: 'f-1' });

    expect(inMemory.pending).toMatchObject([
      {
        declaration: chargeCardV1,
        identity: 'ChargeCard@1',
        subject: 'orders-service.command.ChargeCard.v1',
        body: charge,
      },
    ]);
  });

  test('the adapter never redelivers on its own', async () => {
    const { inMemory, received } = await running(() => ({ charge: throwing }));
    await inMemory.deliver(chargeCardV1, charge);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await rejectionOf(inMemory.settled());

    expect(received).toHaveLength(1);
    expect(inMemory.pending).toHaveLength(1);
  });

  test('redeliver() runs a pending Message again only where it is pending, with deliveryCount 2', async () => {
    const { inMemory, received } = await running(() => ({
      audit: (_body, meta) => {
        if (meta.deliveryCount === 1) {
          throw boom;
        }
        return undefined;
      },
    }));
    await inMemory.deliver(orderCreatedV2, created, { factId: 'o-1' });

    await inMemory.redeliver();

    expect(received.map(({ handler, meta }) => [handler, meta.deliveryCount])).toEqual([
      ['notifyOnCreated', 1],
      ['auditCreated', 1],
      ['auditCreated', 2],
    ]);
    expect(inMemory.pending).toEqual([]);
  });

  test('redeliver() gives the Handler the original ids and headers', async () => {
    const headers = { traceparent: '00-abc-def-01' };
    const { inMemory, received } = await running(() => ({
      charge: (_body, meta) => (meta.deliveryCount === 1 ? throwing() : undefined),
    }));
    await inMemory.deliver(chargeCardV1, charge, { factId: 'f-1', headers });

    await inMemory.redeliver();

    expect(received.map(({ meta }) => meta)).toEqual([
      {
        messageId: 'command.ChargeCard.v1:f-1',
        factId: 'f-1',
        deliveryCount: 1,
        lastAttempt: false,
        headers,
        signal: expect.any(AbortSignal),
      },
      {
        messageId: 'command.ChargeCard.v1:f-1',
        factId: 'f-1',
        deliveryCount: 2,
        lastAttempt: false,
        headers,
        signal: expect.any(AbortSignal),
      },
    ]);
  });

  test('a Message ended on redelivery leaves pending', async () => {
    const { inMemory } = await running(() => ({
      charge: (_body, meta) =>
        meta.deliveryCount === 1 ? throwing() : fault({ committed: 'no', retryable: false }),
    }));
    await inMemory.deliver(chargeCardV1, charge);

    await inMemory.redeliver();

    expect(inMemory.pending).toEqual([]);
  });

  test('an acknowledged Message delivered again is a new Message with deliveryCount 1', async () => {
    const { inMemory, received } = await running();
    await inMemory.deliver(chargeCardV1, charge, { factId: 'f-1' });

    await inMemory.deliver(chargeCardV1, charge, { factId: 'f-1' });

    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 1]);
  });

  test('redeliver() with nothing pending resolves', async () => {
    const { inMemory, received } = await running();

    const redelivering = inMemory.redeliver();

    await expect(redelivering).resolves.toBeUndefined();
    expect(received).toEqual([]);
  });

  test('redeliver() does not retry in the same pass a Message that fails again', async () => {
    const { inMemory, received } = await running(() => ({ charge: throwing }));
    await inMemory.deliver(chargeCardV1, charge);

    await inMemory.redeliver();
    const afterOnePass = received.length;
    await inMemory.redeliver();

    expect(afterOnePass).toBe(2);
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2, 3]);
    expect(inMemory.pending).toMatchObject([{ deliveryCount: 3 }]);
  });

  test('a pending Message delivered again keeps its place in the list', async () => {
    const { inMemory } = await running(() => ({ charge: throwing }));
    await inMemory.deliver(chargeCardV1, charge, { factId: 'a' });
    await inMemory.deliver(chargeCardV1, charge, { factId: 'b' });

    await inMemory.deliver(chargeCardV1, charge, { factId: 'a' });

    expect(inMemory.pending.map(({ factId, deliveryCount }) => [factId, deliveryCount])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });

  test('redeliver() delivers a Message a deliver replaced after the snapshot as it stands', async () => {
    const gate = aGate();
    const { inMemory, sender, received } = await running(() => ({
      charge: async (_body, meta) => {
        if (meta.factId !== 'hold') {
          throw boom;
        }
        await gate.opened;
        return undefined;
      },
    }));
    await inMemory.deliver(chargeCardV1, charge, { factId: 'a' });
    await inMemory.redeliver();
    await sender.send('ChargeCard', charge, { factId: 'hold' });

    const replacing = inMemory.deliver(chargeCardV1, charge, { factId: 'a' });
    const redelivering = inMemory.redeliver();
    gate.open();
    await Promise.all([replacing, redelivering]);

    expect(received.map(({ meta }) => [meta.factId, meta.deliveryCount])).toEqual([
      ['a', 1],
      ['a', 2],
      ['hold', 1],
      ['a', 1],
      ['a', 2],
    ]);
  });

  test('redeliver() skips a Message a deliver acknowledged after the snapshot', async () => {
    const gate = aGate();
    const failed = new Set<string>();
    const { inMemory, sender, received } = await running(() => ({
      charge: async (_body, meta) => {
        if (meta.factId === 'hold') {
          await gate.opened;
        } else if (meta.deliveryCount === 1 && !failed.has(meta.factId)) {
          failed.add(meta.factId);
          throw boom;
        }
        return undefined;
      },
    }));
    await sender.send('ChargeCard', charge, { factId: 'a' });
    await sender.send('ChargeCard', charge, { factId: 'b' });
    await rejectionOf(inMemory.settled());
    await sender.send('ChargeCard', charge, { factId: 'hold' });

    const acknowledging = inMemory.deliver(chargeCardV1, charge, { factId: 'b' });
    const redelivering = inMemory.redeliver();
    gate.open();
    await Promise.all([acknowledging, redelivering]);

    expect(received.map(({ meta }) => [meta.factId, meta.deliveryCount])).toEqual([
      ['a', 1],
      ['b', 1],
      ['hold', 1],
      ['b', 1],
      ['a', 2],
    ]);
    expect(inMemory.pending).toEqual([]);
  });

  test('an own published Message whose Handler threw is redelivered the same way', async () => {
    const { inMemory, publisher, received } = await running(() => ({
      notify: (_body, meta) => (meta.deliveryCount === 1 ? throwing() : undefined),
    }));
    await publisher.publish('OrderCreated', { v1: charge, v2: created }, { factId: 'o-1' });
    await rejectionOf(inMemory.settled());

    await inMemory.redeliver();

    const attempts = received.filter(({ handler }) => handler === 'notifyOnCreated');
    expect(attempts.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
    expect(inMemory.pending).toEqual([]);
  });

  test('a Message a Handler publishes during redeliver() is covered by settled()', async () => {
    const charged: string[] = [];
    const { inMemory } = await running((connection) => ({
      notify: async (_body, meta) => {
        if (meta.deliveryCount === 1) {
          throw boom;
        }
        await connection.sender.send('ChargeCard', charge, { factId: 'f-50' });
        return undefined;
      },
      charge: () => {
        charged.push('charged');
        return undefined;
      },
    }));
    await inMemory.deliver(orderCreatedV2, created);
    await rejectionOf(inMemory.settled());

    await inMemory.redeliver();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const chargedMeanwhile = [...charged];
    await inMemory.settled();

    expect(chargedMeanwhile).toEqual([]);
    expect(charged).toEqual(['charged']);
  });

  test('redeliver stops once the Messages it lined up have settled: what their Handlers send stays lined up, and close() lists it as pending', async () => {
    const charged: string[] = [];
    const { inMemory } = await running((connection) => ({
      notify: async (_body, meta) => {
        if (meta.deliveryCount === 1) {
          throw boom;
        }
        await connection.sender.send('ChargeCard', charge, { factId: 'f-1' });
        await connection.sender.send('ChargeCard', charge, { factId: 'f-2' });
        return undefined;
      },
      charge: () => {
        charged.push('charged');
        return undefined;
      },
    }));
    await inMemory.deliver(orderCreatedV2, created);
    await rejectionOf(inMemory.settled());
    await inMemory.redeliver();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await inMemory.close();

    expect(charged).toEqual([]);
    expect(inMemory.pending.map(({ messageId }) => messageId)).toEqual([
      'command.ChargeCard.v1:f-1',
      'command.ChargeCard.v1:f-2',
    ]);
  });
});
