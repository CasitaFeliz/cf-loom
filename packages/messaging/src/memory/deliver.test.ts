import {
  type ContractPackage,
  defineCommand,
  defineContract,
  defineDependency,
  defineEvent,
  defineGroup,
  defineSubscription,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import {
  type Fault,
  fault,
  handle,
  InvalidInputError,
  type MessageMeta,
  readersOf,
} from '@cf-loom/handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { type ConsumedFault, type Messaging, messaging } from '../index.ts';
import { type MemoryBroker, memory } from './index.ts';

/** The invalid-input body's Reader as `cf-loom package` writes it. */
const invalidInputBody = z.object({
  issues: z.array(
    z.object({
      in: openEnumReader(['body', 'headers', 'params', 'query']),
      path: z.array(z.union([z.string(), z.number()])),
      code: openEnumReader([
        'required',
        'invalid_type',
        'invalid_value',
        'invalid_format',
        'too_small',
        'too_big',
        'not_multiple',
        'unrecognized_key',
        'malformed',
      ]),
      message: z.string(),
    }),
  ),
});

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

const paymentSettledV1 = defineEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});

const payments = {
  name: 'payments-service',
  version: '5.1.0',
  endpoints: {},
  events: { paymentSettledV1 },
  standardRejections: {
    invalidInput: {
      code: 'INVALID_INPUT',
      status: 400,
      message: 'Invalid input',
      body: invalidInputBody,
    },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

const paymentsDependency = defineDependency({ provider: payments });

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

const contract = defineContract({
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
  dependencies: [paymentsDependency],
});

const readerV2 = z.object({ orderId: z.string(), status: openEnumReader(statuses) });

const readers = readersOf({
  commands: { chargeCardV1: { element: chargeCardV1, reader: orderBody } },
  subscriptions: {
    notifyOnCreated: { element: notifyOnCreated, reader: readerV2 },
    auditCreated: {
      element: auditCreated,
      reader: z.object({ orderId: z.uuid(), status: readerV2.shape.status }),
    },
    notifyOnSettled: { element: notifyOnSettled, reader: paymentSettledV1.body },
  },
});

type Received = { readonly handler: string; readonly body: unknown; readonly meta: MessageMeta };

type Implementation = (
  body: unknown,
  meta: MessageMeta,
) => Fault | undefined | Promise<Fault | undefined>;

type Handlers = {
  readonly charge?: Implementation;
  readonly notify?: Implementation;
  readonly audit?: Implementation;
  readonly settled?: Implementation;
};

/** A memory() and the messaging connected through it. */
type Running = Messaging<typeof contract> & {
  readonly broker: MemoryBroker;
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
  const broker = memory();
  const faults: ConsumedFault[] = [];
  const started = await messaging(contract, broker, {
    onServiceFault: (consumedFault) => faults.push(consumedFault),
  });
  const connection = { broker, received, faults, ...started };
  const answers = handlers(connection);
  await started.consume({
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
  });
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

/** Lets every Handler that can run, run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deliver()', () => {
  test('deliver writes a body given as the Subscriber reads it back through the Reader, so the Handler reads { unknown } for an undeclared Open Enum value', async () => {
    const { broker, received } = await running();

    await broker.deliver(orderCreatedV2, { orderId: ORDER_ID, status: { unknown: 'refunded' } });

    const notified = received.find(({ handler }) => handler === 'notifyOnCreated');
    expect(notified?.body).toEqual({ orderId: ORDER_ID, status: { unknown: 'refunded' } });
  });

  test.each<[string, Implementation, string]>([
    ['nothing', () => undefined, 'acked'],
    ['a retryable Fault', () => fault({ committed: 'no', retryable: true }), 'pending'],
    ['a throw', throwing, 'pending'],
    ['a non-retryable Fault', () => fault({ committed: 'no', retryable: false }), 'ended'],
  ])(
    'deliver resolves to acked, pending or ended as the Handler settles: %s',
    async (_answer, answer, expected) => {
      const { broker } = await running(() => ({ charge: answer }));

      const settlement = await broker.deliver(chargeCardV1, charge);

      expect(settlement).toBe(expected);
    },
  );

  test('deliver to a Provider’s Event reaches the Subscription to it', async () => {
    const { broker, received } = await running();

    const settlement = await broker.deliver(paymentSettledV1, { paymentId: PAYMENT_ID });

    expect(settlement).toBe('acked');
    expect(received.map(({ handler, body }) => [handler, body])).toEqual([
      ['notifyOnSettled', { paymentId: PAYMENT_ID }],
    ]);
  });

  test('deliver to a Command reaches its CommandHandler', async () => {
    const { broker, received } = await running();

    await broker.deliver(chargeCardV1, charge);

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
      const { broker, received } = await running(() => ({ notify, audit }));

      const settlement = await broker.deliver(orderCreatedV2, created);

      expect(received.map(({ handler }) => handler)).toEqual(['notifyOnCreated', 'auditCreated']);
      expect(settlement).toBe(expected);
    },
  );

  test('the broker message id defaults to command.<Name>.v<n>:<factId>, and meta.messageId replaces it', async () => {
    const { broker, received } = await running();

    await broker.deliver(chargeCardV1, charge, { factId: 'f-1' });
    await broker.deliver(chargeCardV1, charge, { factId: 'f-2', messageId: 'custom-id' });

    expect(received.map(({ meta }) => [meta.messageId, meta.factId])).toEqual([
      ['command.ChargeCard.v1:f-1', 'f-1'],
      ['custom-id', 'f-2'],
    ]);
  });

  test('without a Fact id, deliver uses a random one', async () => {
    const { broker, received } = await running();

    await broker.deliver(chargeCardV1, charge);
    await broker.deliver(chargeCardV1, charge);

    const [first, second] = received.map(({ meta }) => meta);
    expect(first?.factId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first?.messageId).toBe(`command.ChargeCard.v1:${first?.factId}`);
    expect(second?.factId).not.toBe(first?.factId);
  });

  test('an empty Fact id is refused, and no Handler runs', async () => {
    const { broker, received } = await running();

    const delivering = broker.deliver(chargeCardV1, charge, { factId: '' });

    await expect(delivering).rejects.toThrow('A Fact id is a non-empty string');
    expect(received).toEqual([]);
  });

  test('meta.headers reach the Handler; without them it receives {}', async () => {
    const { broker, received } = await running();
    const headers = { traceparent: '00-abc-def-01' };

    await broker.deliver(chargeCardV1, charge, { headers });
    await broker.deliver(chargeCardV1, charge);

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
  ])('the headers %j are refused, and no Handler runs', async (headers, message) => {
    const { broker, received } = await running();

    const delivering = broker.deliver(chargeCardV1, charge, { headers });

    await expect(delivering).rejects.toThrow(message);
    expect(received).toEqual([]);
  });

  test('a bad Fact id and bad headers together are refused for the Fact id first', async () => {
    const { broker, received } = await running();
    const headers = { 'x-a': 'x ', 'Nats-TTL': '1' };

    const delivering = broker.deliver(chargeCardV1, charge, { factId: 'f-1 ', headers });

    await expect(delivering).rejects.toThrow(/^A Fact id is a non-empty string /);
    expect(received).toEqual([]);
  });

  test('two bad headers are refused for the first one the record lists', async () => {
    const { broker, received } = await running();
    const headers = { 'x-a': 'x ', 'Nats-TTL': '1' };

    const delivering = broker.deliver(chargeCardV1, charge, { headers });

    await expect(delivering).rejects.toThrow(/^The transport header x-a has a value /);
    expect(received).toEqual([]);
  });

  test.each([' f-1', 'f-1 ', 'f-1\n', 'f-1\uD800'])(
    'a Fact id of %j is refused, and no Handler runs',
    async (factId) => {
      const { broker, received } = await running();

      const delivering = broker.deliver(chargeCardV1, charge, { factId });

      await expect(delivering).rejects.toThrow(
        'A Fact id is a non-empty string with no CR or LF, no whitespace leading or trailing and no lone surrogate',
      );
      expect(received).toEqual([]);
    },
  );

  test.each(['', ' m-1', 'm-1 ', 'm-1\n', 'm-1\uD800'])(
    'a broker message id of %j is refused, and no Handler runs',
    async (messageId) => {
      const { broker, received } = await running();

      const delivering = broker.deliver(chargeCardV1, charge, { messageId });

      await expect(delivering).rejects.toThrow(
        'A broker message id is a non-empty string with no CR or LF, no whitespace leading or trailing and no lone surrogate',
      );
      expect(received).toEqual([]);
    },
  );

  test('a Fact id and transport headers whose broker headers would take more bytes than JetStream stores are refused, naming the Message Version, and no Handler runs', async () => {
    const { broker, received } = await running();
    const headers = { 'x-pad': 'p'.repeat(30_000) };

    const delivering = broker.deliver(chargeCardV1, charge, {
      factId: 'f'.repeat(20_000),
      headers,
    });

    await expect(delivering).rejects.toThrow(
      'The broker headers of ChargeCard@1 would take 70077 bytes, over the 65535 JetStream stores; the Fact id counts twice, in Cf-Loom-Fact-Id and in Nats-Msg-Id',
    );
    expect(received).toEqual([]);
  });

  test('a broker message id given is counted in place of command.<Name>.v<n>:<factId>, so a long one is refused and no Handler runs', async () => {
    const { broker, received } = await running();

    const delivering = broker.deliver(chargeCardV1, charge, {
      factId: 'f-1',
      messageId: 'm'.repeat(65_500),
    });

    await expect(delivering).rejects.toThrow(
      /^The broker headers of ChargeCard@1 would take 65549 bytes, over the 65535 JetStream stores/,
    );
    expect(received).toEqual([]);
  });

  test('broker headers of exactly the bytes JetStream stores are delivered as given', async () => {
    const { broker, received } = await running();
    const headers = { 'x-pad': 'p'.repeat(65_452) };

    await broker.deliver(chargeCardV1, charge, { factId: 'f-1', headers });

    expect(received.map(({ meta }) => [meta.factId, meta.headers])).toEqual([['f-1', headers]]);
  });

  test('the same fact delivered twice reaches the Handler twice', async () => {
    const { broker, received } = await running();

    const settlements = [
      await broker.deliver(chargeCardV1, charge, { factId: 'f-1' }),
      await broker.deliver(chargeCardV1, charge, { factId: 'f-1' }),
    ];

    expect(settlements).toEqual(['acked', 'acked']);
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 1]);
  });

  test('a body that breaks the Reader rejects deliver with InvalidInputError at body, and no Handler runs, not even a first Subscription’s', async () => {
    const { broker, received } = await running();
    const wrong = { orderId: 'not-a-uuid', status: 'paid' };

    const rejection = await rejectionOf(broker.deliver(orderCreatedV2, wrong));

    expect(rejection).toBeInstanceOf(InvalidInputError);
    expect(rejection).toMatchObject({
      message: expect.stringContaining('auditCreated'),
      issues: [{ part: 'body', path: ['orderId'], code: 'invalid_format' }],
    });
    expect(received).toEqual([]);
  });

  test('broker headers too large are refused before a body the Reader refuses, and no Handler runs', async () => {
    const { broker, received } = await running();
    const wrong = { orderId: 'not-a-uuid' };

    const rejection = await rejectionOf(
      broker.deliver(chargeCardV1, wrong, { factId: 'o'.repeat(33_000) }),
    );

    expect(rejection).not.toBeInstanceOf(InvalidInputError);
    expect(rejection).toMatchObject({
      message: expect.stringMatching(/^The broker headers of ChargeCard@1 would take 66068 bytes/),
    });
    expect(received).toEqual([]);
  });

  test.each([
    ['a stub’s Subscription', paymentSettledV1, 'PaymentSettled@1'],
    ['a Retired Command', refundV1, 'Refund@1'],
  ])(
    'deliver to an Element nothing consumes rejects, naming it: %s',
    async (_element, element, named) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const broker = memory();
      const { consume } = await messaging(contract, broker);
      await consume({
        commands: { chargeCardV1: handle.stub(readers.commands.chargeCardV1) },
        subscriptions: {
          notifyOnCreated: handle.stub(readers.subscriptions.notifyOnCreated),
          auditCreated: handle.stub(readers.subscriptions.auditCreated),
          notifyOnSettled: handle.stub(readers.subscriptions.notifyOnSettled),
        },
        readers,
      });

      const delivering = broker.deliver(element, {});

      await expect(delivering).rejects.toThrow(`${named} has no consumer`);
    },
  );

  test('deliver before consume rejects, naming the Element', async () => {
    const broker = memory();
    await messaging(contract, broker);

    const delivering = broker.deliver(chargeCardV1, charge);

    await expect(delivering).rejects.toThrow('ChargeCard@1 has no consumer');
  });

  test('deliver waits for the Messages already lined up', async () => {
    const gate = aGate();
    const log: string[] = [];
    const { broker, sender } = await running(() => ({
      charge: async (_body, meta) => {
        log.push(`${meta.factId} starts`);
        await gate.opened;
        log.push(`${meta.factId} ends`);
        return undefined;
      },
    }));
    await sender.send('ChargeCard', charge, { factId: 'sent' });

    const delivering = broker.deliver(chargeCardV1, charge, { factId: 'delivered' });
    await flush();
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
    'a Message whose Handler %s is listed with its Subscription, its ids, its attempt and its headers',
    async (_how, answer) => {
      const headers = { traceparent: '00-abc-def-01' };
      const { broker } = await running(() => ({ notify: answer }));

      await broker.deliver(orderCreatedV2, created, { factId: 'o-1', headers });

      expect(broker.pending).toEqual([
        {
          element: notifyOnCreated,
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

  test('pending lists the wire body, not the form the Handler read', async () => {
    const { broker, received } = await running(() => ({ notify: throwing }));

    await broker.deliver(orderCreatedV2, { orderId: ORDER_ID, status: { unknown: 'refunded' } });

    const read = received.find(({ handler }) => handler === 'notifyOnCreated')?.body;
    expect(read).toEqual({ orderId: ORDER_ID, status: { unknown: 'refunded' } });
    expect(broker.pending.map(({ body }) => body)).toEqual([
      { orderId: ORDER_ID, status: 'refunded' },
    ]);
  });

  test('pending lists a Command left pending with the Command', async () => {
    const { broker } = await running(() => ({ charge: throwing }));

    await broker.deliver(chargeCardV1, charge, { factId: 'f-1' });

    expect(broker.pending).toMatchObject([
      { element: chargeCardV1, subject: 'orders-service.command.ChargeCard.v1', body: charge },
    ]);
  });

  test('the adapter never redelivers on its own', async () => {
    const { broker, received } = await running(() => ({ charge: throwing }));
    await broker.deliver(chargeCardV1, charge);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await rejectionOf(broker.settled());

    expect(received).toHaveLength(1);
    expect(broker.pending).toHaveLength(1);
  });

  test('redeliver() runs a pending Message again only where it is pending, with deliveryCount 2', async () => {
    const { broker, received } = await running(() => ({
      audit: (_body, meta) => {
        if (meta.deliveryCount === 1) {
          throw boom;
        }
        return undefined;
      },
    }));
    await broker.deliver(orderCreatedV2, created, { factId: 'o-1' });

    await broker.redeliver();

    expect(received.map(({ handler, meta }) => [handler, meta.deliveryCount])).toEqual([
      ['notifyOnCreated', 1],
      ['auditCreated', 1],
      ['auditCreated', 2],
    ]);
    expect(broker.pending).toEqual([]);
  });

  test('redeliver() gives the Handler the original ids and headers', async () => {
    const headers = { traceparent: '00-abc-def-01' };
    const { broker, received } = await running(() => ({
      charge: (_body, meta) => (meta.deliveryCount === 1 ? throwing() : undefined),
    }));
    await broker.deliver(chargeCardV1, charge, { factId: 'f-1', headers });

    await broker.redeliver();

    expect(received.map(({ meta }) => meta)).toEqual([
      { messageId: 'command.ChargeCard.v1:f-1', factId: 'f-1', deliveryCount: 1, headers },
      { messageId: 'command.ChargeCard.v1:f-1', factId: 'f-1', deliveryCount: 2, headers },
    ]);
  });

  test('a Message ended on redelivery leaves pending', async () => {
    const { broker } = await running(() => ({
      charge: (_body, meta) =>
        meta.deliveryCount === 1 ? throwing() : fault({ committed: 'no', retryable: false }),
    }));
    await broker.deliver(chargeCardV1, charge);

    await broker.redeliver();

    expect(broker.pending).toEqual([]);
  });

  test('an acknowledged Message delivered again is a new Message with deliveryCount 1', async () => {
    const { broker, received } = await running();
    await broker.deliver(chargeCardV1, charge, { factId: 'f-1' });

    await broker.deliver(chargeCardV1, charge, { factId: 'f-1' });

    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 1]);
  });

  test('redeliver() with nothing pending resolves', async () => {
    const { broker, received } = await running();

    const redelivering = broker.redeliver();

    await expect(redelivering).resolves.toBeUndefined();
    expect(received).toEqual([]);
  });

  test('redeliver() does not retry in the same pass a Message that fails again', async () => {
    const { broker, received } = await running(() => ({ charge: throwing }));
    await broker.deliver(chargeCardV1, charge);

    await broker.redeliver();
    const afterOnePass = received.length;
    await broker.redeliver();

    expect(afterOnePass).toBe(2);
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2, 3]);
    expect(broker.pending).toMatchObject([{ deliveryCount: 3 }]);
  });

  test('a pending Message delivered again keeps its place in the list', async () => {
    const { broker } = await running(() => ({ charge: throwing }));
    await broker.deliver(chargeCardV1, charge, { factId: 'a' });
    await broker.deliver(chargeCardV1, charge, { factId: 'b' });

    await broker.deliver(chargeCardV1, charge, { factId: 'a' });

    expect(broker.pending.map(({ factId, deliveryCount }) => [factId, deliveryCount])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });

  test('redeliver() delivers a Message a deliver replaced after the snapshot as it stands', async () => {
    const gate = aGate();
    const { broker, sender, received } = await running(() => ({
      charge: async (_body, meta) => {
        if (meta.factId !== 'hold') {
          throw boom;
        }
        await gate.opened;
        return undefined;
      },
    }));
    await broker.deliver(chargeCardV1, charge, { factId: 'a' });
    await broker.redeliver();
    await sender.send('ChargeCard', charge, { factId: 'hold' });

    const replacing = broker.deliver(chargeCardV1, charge, { factId: 'a' });
    const redelivering = broker.redeliver();
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
    const { broker, sender, received } = await running(() => ({
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
    await rejectionOf(broker.settled());
    await sender.send('ChargeCard', charge, { factId: 'hold' });

    const acknowledging = broker.deliver(chargeCardV1, charge, { factId: 'b' });
    const redelivering = broker.redeliver();
    gate.open();
    await Promise.all([acknowledging, redelivering]);

    expect(received.map(({ meta }) => [meta.factId, meta.deliveryCount])).toEqual([
      ['a', 1],
      ['b', 1],
      ['hold', 1],
      ['b', 1],
      ['a', 2],
    ]);
    expect(broker.pending).toEqual([]);
  });

  test('an own published Message whose Handler threw is redelivered the same way', async () => {
    const { broker, publisher, received } = await running(() => ({
      notify: (_body, meta) => (meta.deliveryCount === 1 ? throwing() : undefined),
    }));
    await publisher.publish('OrderCreated', { v1: charge, v2: created }, { factId: 'o-1' });
    await rejectionOf(broker.settled());

    await broker.redeliver();

    const attempts = received.filter(({ handler }) => handler === 'notifyOnCreated');
    expect(attempts.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
    expect(broker.pending).toEqual([]);
  });

  test('a Message a Handler publishes during redeliver() is covered by settled()', async () => {
    const gate = aGate();
    const charged: string[] = [];
    const { broker } = await running((connection) => ({
      notify: async (_body, meta) => {
        if (meta.deliveryCount === 1) {
          throw boom;
        }
        await connection.sender.send('ChargeCard', charge);
        return undefined;
      },
      charge: async () => {
        await gate.opened;
        charged.push('charged');
        return undefined;
      },
    }));
    await broker.deliver(orderCreatedV2, created);
    await rejectionOf(broker.settled());

    await broker.redeliver();
    const chargedMeanwhile = [...charged];
    const settling = broker.settled();
    gate.open();
    await settling;

    expect(chargedMeanwhile).toEqual([]);
    expect(charged).toEqual(['charged']);
  });
});
