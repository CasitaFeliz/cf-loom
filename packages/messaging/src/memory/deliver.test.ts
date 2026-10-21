import {
  type ContractPackage,
  defineCommand,
  defineContract,
  defineDependencies,
  defineEvent,
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
  withReader,
} from '@cf-loom/handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { type ConsumedFault, type Messaging, messaging } from '../index.ts';
import { type MemoryBroker, memory } from './index.ts';

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
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

const paymentsDeps = defineDependencies(payments, { events: [paymentSettledV1] });

const notifyOnCreated = defineSubscription({ name: 'notify-on-created', event: orderCreatedV2 });

const auditCreated = defineSubscription({ name: 'audit-created', event: orderCreatedV2 });

const notifyOnSettled = defineSubscription({ name: 'notify-on-settled', event: paymentSettledV1 });

const contract = defineContract({
  name: 'orders-service',
  events: [orderCreatedV1, orderCreatedV2],
  commands: [chargeCardV1, refundV1],
  subscriptions: [notifyOnCreated, auditCreated, notifyOnSettled],
  dependencies: [paymentsDeps],
});

const readerV2 = z.object({ orderId: z.string(), status: openEnumReader(statuses) });

const pairings = {
  chargeCard: withReader(chargeCardV1, orderBody),
  notifyOnCreated: withReader(notifyOnCreated, readerV2),
  auditCreated: withReader(
    auditCreated,
    z.object({ orderId: z.uuid(), status: readerV2.shape.status }),
  ),
  notifyOnSettled: withReader(notifyOnSettled, paymentSettledV1.body),
};

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
        pairings.chargeCard,
        recording(received, 'ChargeCard@1', answers.charge),
      ),
    },
    subscriptions: {
      'notify-on-created': handle(
        pairings.notifyOnCreated,
        recording(received, 'notify-on-created', answers.notify),
      ),
      'audit-created': handle(
        pairings.auditCreated,
        recording(received, 'audit-created', answers.audit),
      ),
      'notify-on-settled': handle(
        pairings.notifyOnSettled,
        recording(received, 'notify-on-settled', answers.settled),
      ),
    },
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

    const notified = received.find(({ handler }) => handler === 'notify-on-created');
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

  test('deliver to a Dependency’s Event reaches the Subscription to it', async () => {
    const { broker, received } = await running();

    const settlement = await broker.deliver(paymentSettledV1, { paymentId: PAYMENT_ID });

    expect(settlement).toBe('acked');
    expect(received.map(({ handler, body }) => [handler, body])).toEqual([
      ['notify-on-settled', { paymentId: PAYMENT_ID }],
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

      expect(received.map(({ handler }) => handler)).toEqual([
        'notify-on-created',
        'audit-created',
      ]);
      expect(settlement).toBe(expected);
    },
  );

  test('the broker message id defaults to <Name>.v<n>:<factId>, and meta.messageId replaces it', async () => {
    const { broker, received } = await running();

    await broker.deliver(chargeCardV1, charge, { factId: 'f-1' });
    await broker.deliver(chargeCardV1, charge, { factId: 'f-2', messageId: 'custom-id' });

    expect(received.map(({ meta }) => [meta.messageId, meta.factId])).toEqual([
      ['ChargeCard.v1:f-1', 'f-1'],
      ['custom-id', 'f-2'],
    ]);
  });

  test('without a Fact id, deliver uses a random one', async () => {
    const { broker, received } = await running();

    await broker.deliver(chargeCardV1, charge);
    await broker.deliver(chargeCardV1, charge);

    const [first, second] = received.map(({ meta }) => meta);
    expect(first?.factId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first?.messageId).toBe(`ChargeCard.v1:${first?.factId}`);
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

  test.each(['Nats-Msg-Id', 'cf-loom-fact-id'])(
    'a header named %s is refused, and no Handler runs',
    async (name) => {
      const { broker, received } = await running();

      const delivering = broker.deliver(chargeCardV1, charge, { headers: { [name]: 'x' } });

      await expect(delivering).rejects.toThrow(
        `The transport header ${name} takes a name cf-loom sets itself`,
      );
      expect(received).toEqual([]);
    },
  );

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
      message: expect.stringContaining('audit-created'),
      issues: [{ part: 'body', path: ['orderId'], code: 'invalid_format' }],
    });
    expect(received).toEqual([]);
  });

  test.each([
    ['a stub’s Subscription', paymentSettledV1, 'PaymentSettled@1'],
    ['a Retired Command', refundV1, 'Refund@1'],
  ])(
    'deliver to an Element nothing consumes throws, naming it: %s',
    async (_element, element, named) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const broker = memory();
      const { consume } = await messaging(contract, broker);
      await consume({
        commands: { chargeCardV1: handle.stub(pairings.chargeCard) },
        subscriptions: {
          'notify-on-created': handle.stub(pairings.notifyOnCreated),
          'audit-created': handle.stub(pairings.auditCreated),
          'notify-on-settled': handle.stub(pairings.notifyOnSettled),
        },
      });

      const delivering = broker.deliver(element, {});

      await expect(delivering).rejects.toThrow(`${named} has no consumer`);
    },
  );

  test('deliver before consume throws, naming the Element', async () => {
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
          messageId: 'OrderCreated.v2:o-1',
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

    const read = received.find(({ handler }) => handler === 'notify-on-created')?.body;
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
      ['notify-on-created', 1],
      ['audit-created', 1],
      ['audit-created', 2],
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
      { messageId: 'ChargeCard.v1:f-1', factId: 'f-1', deliveryCount: 1, headers },
      { messageId: 'ChargeCard.v1:f-1', factId: 'f-1', deliveryCount: 2, headers },
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

  test('redeliver() delivers an entry a deliver replaced after the snapshot from the entry as it stands', async () => {
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

  test('redeliver() skips an entry a deliver acknowledged after the snapshot', async () => {
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

    const attempts = received.filter(({ handler }) => handler === 'notify-on-created');
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
