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
import { fault, handle, readersOf, type WithResources } from '@cf-loom/handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import {
  type Broker,
  type BrokerConsumer,
  type ConsumedFault,
  type Delivery,
  messaging,
  type Settlement,
} from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const statuses = ['pending', 'paid'] as const;

const orderBody = z.object({ orderId: z.uuid(), status: openEnum(statuses) });

const orderReader = z.object({ orderId: z.uuid(), status: openEnumReader(statuses) });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was created',
  body: orderBody,
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  lifecycle: 'deprecated',
  description: 'Charges the order’s card',
  body: orderBody,
});

const chargeCardV2 = defineCommand({
  name: 'ChargeCard',
  version: 2,
  description: 'Charges the order’s card, again',
  body: orderBody,
});

const refundV1 = defineCommand({
  name: 'Refund',
  version: 1,
  lifecycle: 'retired',
  description: 'Refunds the order',
  body: orderBody,
});

/** A Provider's Event as its Contract Package declares it: its body a Reader. */
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

const paymentsDependency = defineDependency({ provider: payments });

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV1,
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
      events: [orderCreatedV1],
      commands: [chargeCardV1, chargeCardV2, refundV1],
      subscriptions: [notifyOnCreated, notifyOnSettled],
    }),
  ],
  dependencies: [paymentsDependency],
});

const readers = readersOf({
  commands: {
    chargeCardV1: { element: chargeCardV1, reader: orderReader },
    chargeCardV2: { element: chargeCardV2, reader: orderReader },
  },
  subscriptions: {
    notifyOnCreated: { element: notifyOnCreated, reader: orderReader },
    notifyOnSettled: { element: notifyOnSettled, reader: paymentSettledV1.body },
  },
});

const handlers = {
  commands: {
    chargeCardV1: handle(readers.commands.chargeCardV1, () => undefined),
    chargeCardV2: handle(readers.commands.chargeCardV2, () => undefined),
  },
  subscriptions: {
    notifyOnCreated: handle(readers.subscriptions.notifyOnCreated, () => undefined),
    notifyOnSettled: handle(readers.subscriptions.notifyOnSettled, () => undefined),
  },
  readers,
};

const created = 'orders-service.event.OrderCreated.v1';

const chargeCard = 'orders-service.command.ChargeCard.v2';

const body = { orderId: ORDER_ID, status: 'paid' };

/** A broker that records the consumers messaging gives it and delivers to them. */
function aBroker() {
  const consumers: BrokerConsumer[] = [];
  const broker: Broker = {
    connect: async () => ({
      publish: async () => undefined,
      consume: async (given) => {
        consumers.push(...given);
      },
      close: async () => undefined,
    }),
  };
  const deliver = (
    subject: string,
    delivered: unknown,
    delivery: Partial<Delivery> = {},
  ): Promise<Settlement> => {
    const consumer = consumers.find((candidate) => candidate.subject === subject);
    if (consumer === undefined) {
      throw new Error(`Nothing consumes ${subject}`);
    }
    const bytes =
      delivered instanceof Uint8Array
        ? delivered
        : new TextEncoder().encode(JSON.stringify(delivered));
    const meta = { messageId: 'm-1', factId: 'f-1', deliveryCount: 1, headers: {} };
    return consumer.receive({ ...meta, body: bytes, ...delivery });
  };
  return { broker, consumers, deliver };
}

/** A messaging connected and consuming, its Handlers replaced by those given and its faults kept. */
async function consuming(
  replaced: { readonly commands?: object; readonly subscriptions?: object } = {},
) {
  const faults: ConsumedFault[] = [];
  const recording = aBroker();
  const { consume } = await messaging(contract, recording.broker, {
    onServiceFault: (consumedFault) => faults.push(consumedFault),
  });
  await consume({
    commands: { ...handlers.commands, ...replaced.commands },
    subscriptions: { ...handlers.subscriptions, ...replaced.subscriptions },
    readers,
  });
  return { ...recording, faults };
}

/** A Handler of `notifyOnCreated` that keeps what it receives and answers what it is given. */
function receiving(answer: () => unknown = () => undefined) {
  const received: unknown[] = [];
  const notifying = handle(readers.subscriptions.notifyOnCreated, (given, meta) => {
    received.push(given, meta);
    return answer() as undefined;
  });
  return { received, subscriptions: { notifyOnCreated: notifying } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('consume', () => {
  test('hands its Resources to the Handler of every Message delivered', async () => {
    type Notifications = { readonly notifications: { readonly sent: string[] } };
    const resources: Notifications = { notifications: { sent: [] } };
    const taken: unknown[] = [];
    const recording = aBroker();
    const { consume } = await messaging(contract, recording.broker);
    await consume(
      {
        commands: {
          ...handlers.commands,
          chargeCardV2: handle(
            readers.commands.chargeCardV2,
            (_given, _meta, call: WithResources<Notifications>) => {
              taken.push(call.resources);
            },
          ),
        },
        subscriptions: {
          ...handlers.subscriptions,
          notifyOnCreated: handle(
            readers.subscriptions.notifyOnCreated,
            (_given, _meta, call: WithResources<Notifications>) => {
              taken.push(call.resources);
            },
          ),
        },
        readers,
      },
      { resources },
    );

    await recording.deliver(chargeCard, body);
    await recording.deliver(created, body);

    expect(taken).toHaveLength(2);
    expect(taken[0]).toBe(resources);
    expect(taken[1]).toBe(resources);
  });

  test('consume gives the broker one consumer per Subscription and per Command Version not Retired, with its subject, stream and durable consumer name', async () => {
    const { consumers } = await consuming();

    const routes = consumers.map(({ subject, stream, durable }) => ({ subject, stream, durable }));

    expect(routes).toEqual([
      {
        subject: 'orders-service.command.ChargeCard.v1',
        stream: 'orders-service',
        durable: 'orders-service_command_ChargeCard_v1',
      },
      {
        subject: 'orders-service.command.ChargeCard.v2',
        stream: 'orders-service',
        durable: 'orders-service_command_ChargeCard_v2',
      },
      {
        subject: 'orders-service.event.OrderCreated.v1',
        stream: 'orders-service',
        durable: 'orders-service_notify-on-created',
      },
      {
        subject: 'payments-service.event.PaymentSettled.v1',
        stream: 'payments-service',
        durable: 'orders-service_notify-on-settled',
      },
    ]);
  });

  test('each consumer carries the Command or Subscription it consumes and the Reader the Handler map pairs with it', async () => {
    const { consumers } = await consuming();

    const carried = consumers.map(({ element, reader }) => ({ element, reader }));

    expect(carried).toEqual([
      readers.commands.chargeCardV1,
      readers.commands.chargeCardV2,
      readers.subscriptions.notifyOnCreated,
      readers.subscriptions.notifyOnSettled,
    ]);
  });

  test('a Subscription to a Provider’s Event reads the Provider’s stream and subject', async () => {
    const { consumers } = await consuming();

    const settled = consumers.find((consumer) => consumer.element === notifyOnSettled);

    expect(settled).toMatchObject({
      stream: 'payments-service',
      subject: 'payments-service.event.PaymentSettled.v1',
    });
  });

  test('a Deprecated Command’s Version is consumed; a Retired one needs no Handler and is not', async () => {
    const { consumers } = await consuming();

    const elements = consumers.map((consumer) => consumer.element);

    expect(elements).toContain(chargeCardV1);
    expect(elements).not.toContain(refundV1);
  });

  test('a stub is not given to the broker, and consume warns naming it', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { consumers } = await consuming({
      commands: { chargeCardV1: handle.stub(readers.commands.chargeCardV1) },
      subscriptions: { notifyOnCreated: handle.stub(readers.subscriptions.notifyOnCreated) },
    });

    expect(consumers.map((consumer) => consumer.element)).toEqual([chargeCardV2, notifyOnSettled]);
    expect(warned.mock.calls).toEqual([
      ["ChargeCard@1's Handler is a stub: consume does not pull its Messages"],
      ["notifyOnCreated's Handler is a stub: consume does not pull its Messages"],
    ]);
  });

  test.each([
    ['subscriptions', 'notifyOnSettled', 'subscriptions.notifyOnSettled'],
    ['commands', 'chargeCardV1', 'commands.chargeCardV1'],
  ] as const)(
    'a %s Handler missing from the map throws, naming its key',
    async (map, key, named) => {
      const { [key]: _missing, ...kept } = handlers[map] as Record<string, unknown>;
      const { consume } = await messaging(contract, aBroker().broker);

      const consumingAll = consume({ ...handlers, [map]: kept });

      await expect(consumingAll).rejects.toThrow(`${named} has no Handler in the Handler map`);
    },
  );

  test('a Handler written for another Subscription throws, naming its key', async () => {
    const swapped = {
      ...handlers.subscriptions,
      notifyOnSettled: handlers.subscriptions.notifyOnCreated,
    };
    const { consume } = await messaging(contract, aBroker().broker);

    const swapping = consume({ ...handlers, subscriptions: swapped });

    await expect(swapping).rejects.toThrow(
      'subscriptions.notifyOnSettled holds no Handler handle() returned for it: run cf-loom generate',
    );
  });

  test('a Handler written for another pairing than the Handler map’s throws, naming its key', async () => {
    const looseReader = z.looseObject({});
    const written = handle({ element: notifyOnCreated, reader: looseReader }, () => undefined);
    const { consume } = await messaging(contract, aBroker().broker);

    const consumingWritten = consume({
      ...handlers,
      subscriptions: { ...handlers.subscriptions, notifyOnCreated: written },
    });

    await expect(consumingWritten).rejects.toThrow(
      'subscriptions.notifyOnCreated holds a Handler written for another pairing than readers.subscriptions.notifyOnCreated: run cf-loom generate',
    );
  });

  test.each([
    ['subscriptions', 'notifyOnSettled'],
    ['commands', 'chargeCardV1'],
  ] as const)(
    'readers that lack the pairing of a %s Handler throw, naming it',
    async (table, key) => {
      const { [key]: _missing, ...kept } = readers[table] as Record<string, unknown>;
      const { consume } = await messaging(contract, aBroker().broker);

      const consumingAll = consume({ ...handlers, readers: { ...readers, [table]: kept } });

      await expect(consumingAll).rejects.toThrow(
        `readers.${table}.${key} is not in the Handler map: run cf-loom generate`,
      );
    },
  );

  test('a Handler the map only inherits throws, as if it had none', async () => {
    const inherited = Object.create(handlers.subscriptions);
    const { consume } = await messaging(contract, aBroker().broker);

    const inheriting = consume({ ...handlers, subscriptions: inherited });

    await expect(inheriting).rejects.toThrow(
      'subscriptions.notifyOnCreated has no Handler in the Handler map',
    );
  });

  test('consume finds a Subscription’s Handler under its camelCase name', async () => {
    const { received, subscriptions } = receiving();
    const { deliver } = await consuming({ subscriptions });

    await deliver(created, body);

    expect(received[0]).toEqual(body);
  });

  test('consuming twice throws', async () => {
    const { consume } = await messaging(contract, aBroker().broker);
    await consume(handlers);

    const again = consume(handlers);

    await expect(again).rejects.toThrow('consume() was already called on this messaging');
  });
});

describe('a Message delivered', () => {
  test('the Handler receives the body read with the Reader the Handler map pairs: an undeclared Open Enum value reaches it as its Unknown case, { unknown }, unknown keys stripped', async () => {
    const { received, subscriptions } = receiving();
    const { deliver } = await consuming({ subscriptions });

    await deliver(created, { orderId: ORDER_ID, status: 'refunded', extra: 'dropped' });

    expect(received[0]).toEqual({ orderId: ORDER_ID, status: { unknown: 'refunded' } });
  });

  test('the Handler receives messageId, factId, deliveryCount and headers as delivered', async () => {
    const { received, subscriptions } = receiving();
    const { deliver } = await consuming({ subscriptions });
    const meta = {
      messageId: 'event.OrderCreated.v1:o-1',
      factId: 'o-1',
      deliveryCount: 3,
      headers: { traceparent: '00-abc-def-01' },
    };

    await deliver(created, body, meta);

    expect(received[1]).toEqual(meta);
  });

  test('returning nothing acknowledges it', async () => {
    const { deliver, faults } = await consuming();

    const settlement = await deliver(created, body);

    expect(settlement).toEqual({ kind: 'acked' });
    expect(faults).toEqual([]);
  });

  test('a retryable Fault leaves it pending, and onServiceFault receives nothing', async () => {
    const { subscriptions } = receiving(() => fault({ committed: 'no', retryable: true }));
    const { deliver, faults } = await consuming({ subscriptions });

    const settlement = await deliver(created, body);

    expect(settlement).toEqual({ kind: 'pending', fault: undefined });
    expect(faults).toEqual([]);
  });

  test('a non-retryable Fault ends it, and onServiceFault receives it as returned, unchanged', async () => {
    const returned = fault({ committed: 'yes', retryable: false, message: 'Card refused' });
    const { subscriptions } = receiving(() => returned);
    const { deliver, faults } = await consuming({ subscriptions });

    const settlement = await deliver(created, body);

    expect(settlement.kind).toBe('ended');
    expect(faults).toEqual([
      {
        element: 'notifyOnCreated',
        subject: created,
        messageId: 'm-1',
        factId: 'f-1',
        kind: 'returned',
        fault: returned,
      },
    ]);
    expect(faults[0]?.kind === 'returned' && faults[0].fault).toBe(returned);
  });

  test('a throw leaves it pending, and onServiceFault receives it as thrown with the error as cause', async () => {
    const error = new Error('gateway down');
    const { subscriptions } = receiving(() => {
      throw error;
    });
    const { deliver, faults } = await consuming({ subscriptions });

    const settlement = await deliver(created, body);

    expect(settlement.kind).toBe('pending');
    expect(faults).toEqual([
      {
        element: 'notifyOnCreated',
        subject: created,
        messageId: 'm-1',
        factId: 'f-1',
        kind: 'thrown',
        cause: error,
      },
    ]);
  });

  test('a return that is neither nothing nor a Fault leaves it pending, reported as thrown with a TypeError', async () => {
    const { subscriptions } = receiving(() => 'done');
    const { deliver, faults } = await consuming({ subscriptions });

    const settlement = await deliver(created, body);

    expect(settlement.kind).toBe('pending');
    expect(faults).toMatchObject([{ kind: 'thrown', cause: expect.any(TypeError) }]);
  });

  test('a body that fails its Reader ends it without running the Handler, reported as invalid-body with its subject, ids and Issues at body', async () => {
    const { received, subscriptions } = receiving();
    const { deliver, faults } = await consuming({ subscriptions });

    const settlement = await deliver(created, { orderId: 'nope', status: 'paid' });

    expect(settlement.kind).toBe('ended');
    expect(received).toEqual([]);
    expect(faults).toEqual([
      {
        element: 'notifyOnCreated',
        subject: created,
        messageId: 'm-1',
        factId: 'f-1',
        kind: 'invalid-body',
        issues: [
          { part: 'body', path: ['orderId'], code: 'invalid_format', message: expect.any(String) },
        ],
      },
    ]);
  });

  test('a body that is not UTF-8 JSON ends it as invalid-body with a malformed Issue', async () => {
    const { deliver, faults } = await consuming();

    const settlements = [
      await deliver(created, new TextEncoder().encode('{"orderId":')),
      await deliver(created, new Uint8Array([0xff, 0xfe])),
    ];

    expect(settlements.map((settlement) => settlement.kind)).toEqual(['ended', 'ended']);
    expect(
      faults.map((consumedFault) => consumedFault.kind === 'invalid-body' && consumedFault.issues),
    ).toEqual([
      [{ part: 'body', path: [], code: 'malformed', message: 'The body is not JSON' }],
      [{ part: 'body', path: [], code: 'malformed', message: 'The body is not JSON' }],
    ]);
  });

  test('onServiceFault names a Subscription by name and a Command by its identity', async () => {
    const { deliver, faults } = await consuming();

    await deliver(created, {});
    await deliver(chargeCard, {});

    expect(faults.map((consumedFault) => consumedFault.element)).toEqual([
      'notifyOnCreated',
      'ChargeCard@2',
    ]);
  });

  test('the settlement carries what onServiceFault received', async () => {
    const error = new Error('gateway down');
    const { subscriptions } = receiving(() => {
      throw error;
    });
    const { deliver, faults } = await consuming({ subscriptions });

    const settlement = await deliver(created, body);

    expect(settlement).toEqual({ kind: 'pending', fault: faults[0] });
  });

  test('without onServiceFault, an ended Message is logged one line per Issue with its subject, broker message id and Fact id, never the value', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { broker, deliver } = aBroker();
    const { consume } = await messaging(contract, broker);
    await consume(handlers);

    await deliver(created, { orderId: 'secret-value', status: 7 });

    expect(logged.mock.calls).toEqual([
      [
        expect.stringMatching(
          /^notifyOnCreated orders-service\.event\.OrderCreated\.v1 m-1 f-1: body\.orderId invalid_format: /,
        ),
      ],
      [
        expect.stringMatching(
          /^notifyOnCreated orders-service\.event\.OrderCreated\.v1 m-1 f-1: body\.status invalid_value: /,
        ),
      ],
    ]);
    expect(logged.mock.calls.flat().join('\n')).not.toContain('secret-value');
  });

  test('without onServiceFault, a Fault or a throw is logged with its message and cause', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('gateway down');
    const refused = fault({
      committed: 'no',
      retryable: false,
      message: 'Card refused',
      cause: error,
    });
    const { broker, deliver } = aBroker();
    const { consume } = await messaging(contract, broker);
    await consume({
      commands: {
        ...handlers.commands,
        chargeCardV2: handle(readers.commands.chargeCardV2, () => refused),
      },
      subscriptions: {
        ...handlers.subscriptions,
        ...receiving(() => {
          throw error;
        }).subscriptions,
      },
      readers,
    });

    await deliver(chargeCard, body);
    await deliver(created, body);

    expect(logged.mock.calls).toEqual([
      ['ChargeCard@2 orders-service.command.ChargeCard.v2 m-1 f-1: Card refused', error],
      ['notifyOnCreated orders-service.event.OrderCreated.v1 m-1 f-1: the Handler threw', error],
    ]);
  });

  test('what onServiceFault throws rejects the delivery', async () => {
    const error = new Error('the hook broke');
    const { broker, deliver } = aBroker();
    const { consume } = await messaging(contract, broker, {
      onServiceFault: () => {
        throw error;
      },
    });
    await consume(handlers);

    const delivering = deliver(created, {});

    await expect(delivering).rejects.toBe(error);
  });
});
