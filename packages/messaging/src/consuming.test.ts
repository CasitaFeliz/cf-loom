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
import { fault, handle, readersOf, type WithResources } from '@cf-loom/handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { planOf } from '../test/broker-plans.ts';
import {
  type Broker,
  type ConsumedFault,
  DeadlineError,
  type Delivery,
  type DurableConsumer,
  MessagingClosedError,
  type MessagingOptions,
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
const paymentSettledV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});

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

const contract = defineService({
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
});

const readers = readersOf({
  commands: {
    chargeCardV1: { declaration: chargeCardV1, reader: orderReader },
    chargeCardV2: { declaration: chargeCardV2, reader: orderReader },
  },
  subscriptions: {
    notifyOnCreated: { declaration: notifyOnCreated, reader: orderReader },
    notifyOnSettled: { declaration: notifyOnSettled, reader: paymentSettledV1.body },
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

/** A broker that records the Durable consumers messaging gives it and delivers to them. */
function aBroker() {
  const durableConsumers: DurableConsumer[] = [];
  const broker: Broker = {
    connect: async () => ({
      publish: async () => ({ duplicate: false }),
      consume: async (given) => {
        for (const consumer of given) {
          durableConsumers.push(consumer);
        }
      },
      close: async () => undefined,
    }),
  };
  const deliver = (
    subject: string,
    delivered: unknown,
    delivery: Partial<Delivery> = {},
  ): Promise<Settlement> => {
    const durableConsumer = durableConsumers.find((candidate) => candidate.subject === subject);
    if (durableConsumer === undefined) {
      throw new Error(`Nothing consumes ${subject}`);
    }
    const bytes =
      delivered instanceof Uint8Array
        ? delivered
        : new TextEncoder().encode(JSON.stringify(delivered));
    const meta = {
      messageId: 'm-1',
      factId: 'f-1',
      deliveryCount: 1,
      lastAttempt: false,
      waitMs: undefined,
      headers: {},
    };
    return durableConsumer.receive({ ...meta, body: bytes, ...delivery });
  };
  return { broker, durableConsumers, deliver };
}

/** A messaging connected and consuming, its Handlers replaced by those given and its faults kept. */
async function consuming(
  replaced: { readonly commands?: object; readonly subscriptions?: object } = {},
  options: MessagingOptions = {},
) {
  const faults: ConsumedFault[] = [];
  const recording = aBroker();
  const { consume, close } = await messaging(contract, recording.broker, {
    onServiceFault: (consumedFault) => {
      faults.push(consumedFault);
    },
    ...options,
  });
  await consume(
    {
      commands: { ...handlers.commands, ...replaced.commands },
      subscriptions: { ...handlers.subscriptions, ...replaced.subscriptions },
      readers,
    },
    {},
  );
  return { ...recording, faults, close };
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

/** A Handler of `notifyOnCreated` that keeps the signal it receives and runs until `until` settles. */
function runningUntil(until: Promise<unknown>) {
  const signals: AbortSignal[] = [];
  const notifying = handle(readers.subscriptions.notifyOnCreated, async (_body, meta) => {
    signals.push(meta.signal);
    await until;
  });
  return { signals, subscriptions: { notifyOnCreated: notifying } };
}

/** A promise that never settles: a Handler that never answers. */
const never = new Promise<never>(() => undefined);

const oneDayMs = 86_400_000;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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

  test('consume gives the broker one Durable consumer per Subscription and per Command Version not Retired, with its subject, stream and Durable consumer name', async () => {
    const { durableConsumers } = await consuming();

    const routes = durableConsumers.map(({ subject, stream, durable }) => ({
      subject,
      stream,
      durable,
    }));

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

  test('the Durable consumers consume gives the broker are those the Contract’s broker plan holds', async () => {
    const { durableConsumers } = await consuming();

    const consumed = durableConsumers.map(({ durable, stream, subject }) => [
      durable,
      { service: 'orders-service', stream, subject },
    ]);

    expect(Object.fromEntries(consumed)).toEqual(planOf(contract, null).durableConsumers);
  });

  test('a Subscription to a Provider’s Event consumes from that Provider’s stream and subject, with no Dependency', async () => {
    const { durableConsumers } = await consuming();

    const settled = durableConsumers.find(
      (durableConsumer) => durableConsumer.durable === 'orders-service_notify-on-settled',
    );

    expect(settled).toMatchObject({
      stream: 'payments-service',
      subject: 'payments-service.event.PaymentSettled.v1',
    });
  });

  test('a Subscription to a Provider’s Event that a Group also lists still reads the Provider’s stream, never the Service’s own', async () => {
    const group = defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1, paymentSettledV1],
      commands: [chargeCardV1, chargeCardV2, refundV1],
      subscriptions: [notifyOnCreated, notifyOnSettled],
    } as unknown as Parameters<typeof defineGroup>[0]);
    const listing = defineService({
      name: 'orders-service',
      groups: [group],
    });
    const recording = aBroker();
    const { consume } = await messaging(listing, recording.broker);

    await consume({ ...handlers, readers }, {});

    const settled = recording.durableConsumers.find(
      (durableConsumer) => durableConsumer.durable === 'orders-service_notify-on-settled',
    );
    expect(settled).toMatchObject({
      stream: 'payments-service',
      subject: 'payments-service.event.PaymentSettled.v1',
    });
  });

  test('a Deprecated Command’s Version is consumed; a Retired one needs no Handler and is not', async () => {
    const { durableConsumers } = await consuming();

    const durables = durableConsumers.map((durableConsumer) => durableConsumer.durable);

    expect(durables).toContain('orders-service_command_ChargeCard_v1');
    expect(durables).not.toContain('orders-service_command_Refund_v1');
  });

  test('a stub is not given to the broker, and consume warns naming it', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { durableConsumers } = await consuming({
      commands: { chargeCardV1: handle.stub(readers.commands.chargeCardV1) },
      subscriptions: { notifyOnCreated: handle.stub(readers.subscriptions.notifyOnCreated) },
    });

    expect(durableConsumers.map((durableConsumer) => durableConsumer.durable)).toEqual([
      'orders-service_command_ChargeCard_v2',
      'orders-service_notify-on-settled',
    ]);
    expect(warned.mock.calls).toEqual([
      ["ChargeCard@1's Handler is a Stub: consume does not pull its Messages"],
      ["notifyOnCreated's Handler is a Stub: consume does not pull its Messages"],
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

      const consumingAll = consume({ ...handlers, [map]: kept }, {});

      await expect(consumingAll).rejects.toThrow(`${named} has no Handler in the Handler map`);
    },
  );

  test('a Handler written for another Subscription throws, naming its key', async () => {
    const swapped = {
      ...handlers.subscriptions,
      notifyOnSettled: handlers.subscriptions.notifyOnCreated,
    };
    const { consume } = await messaging(contract, aBroker().broker);

    // @ts-expect-error notifyOnSettled holds the Handler of notifyOnCreated
    const swapping = consume({ ...handlers, subscriptions: swapped }, {});

    await expect(swapping).rejects.toThrow(
      'subscriptions.notifyOnSettled holds the Handler written for notifyOnCreated',
    );
  });

  test('a Handler written for another pairing than the Handler map’s throws, naming its key', async () => {
    const looseReader = z.looseObject({});
    const written = handle({ declaration: notifyOnCreated, reader: looseReader }, () => undefined);
    const { consume } = await messaging(contract, aBroker().broker);

    const consumingWritten = consume(
      {
        ...handlers,
        subscriptions: { ...handlers.subscriptions, notifyOnCreated: written },
      },
      {},
    );

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

      const consumingAll = consume({ ...handlers, readers: { ...readers, [table]: kept } }, {});

      await expect(consumingAll).rejects.toThrow(
        `readers.${table}.${key} is not in the Handler map: run cf-loom generate`,
      );
    },
  );

  test('a Handler the map only inherits throws, as if it had none', async () => {
    const inherited: typeof handlers.subscriptions = Object.create(handlers.subscriptions);
    const { consume } = await messaging(contract, aBroker().broker);

    const inheriting = consume({ ...handlers, subscriptions: inherited }, {});

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
    await consume(handlers, {});

    const again = consume(handlers, {});

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

  test('the Handler receives messageId, factId, deliveryCount, lastAttempt and headers as delivered', async () => {
    const { received, subscriptions } = receiving();
    const { deliver } = await consuming({ subscriptions });
    const meta = {
      messageId: 'event.OrderCreated.v1:o-1',
      factId: 'o-1',
      deliveryCount: 3,
      lastAttempt: false,
      headers: { traceparent: '00-abc-def-01' },
    };

    await deliver(created, body, meta);

    expect(received[1]).toEqual({ ...meta, signal: expect.any(AbortSignal) });
  });

  test('returning nothing acknowledges it', async () => {
    const { deliver, faults } = await consuming();

    const settlement = await deliver(created, body);

    expect(settlement).toBe('acked');
    expect(faults).toEqual([]);
  });

  test('a retryable Fault leaves it pending, and onServiceFault receives it as returned with its deliveryCount', async () => {
    const returned = fault({ committed: 'no', retryable: true, message: 'card 503' });
    const { subscriptions } = receiving(() => returned);
    const { deliver, faults } = await consuming({ subscriptions });

    const settlement = await deliver(created, body, { deliveryCount: 2 });

    expect(settlement).toBe('pending');
    expect(faults).toEqual([
      {
        declaration: notifyOnCreated,
        name: 'notifyOnCreated',
        subject: created,
        messageId: 'm-1',
        factId: 'f-1',
        deliveryCount: 2,
        lastAttempt: false,
        kind: 'returned',
        fault: returned,
      },
    ]);
  });

  test('a delivery’s lastAttempt reaches onServiceFault', async () => {
    const { subscriptions } = receiving(() => fault({ committed: 'no', retryable: true }));
    const { deliver, faults } = await consuming({ subscriptions });

    await deliver(created, body, { deliveryCount: 3, lastAttempt: true });

    expect(faults).toMatchObject([{ deliveryCount: 3, lastAttempt: true }]);
  });

  test('a delivery’s lastAttempt reaches the Handler’s meta', async () => {
    const { received, subscriptions } = receiving();
    const { deliver } = await consuming({ subscriptions });

    await deliver(created, body, { deliveryCount: 3, lastAttempt: true });

    expect(received[1]).toMatchObject({ deliveryCount: 3, lastAttempt: true });
  });

  test('without onServiceFault, a retryable Fault is one console line with its attempt, and the last attempt says so', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { broker, deliver } = aBroker();
    const { consume } = await messaging(contract, broker);
    await consume(
      {
        ...handlers,
        subscriptions: {
          ...handlers.subscriptions,
          ...receiving(() => fault({ committed: 'no', retryable: true, message: 'card 503' }))
            .subscriptions,
        },
      },
      {},
    );

    await deliver(created, body, { deliveryCount: 2 });
    await deliver(created, body, { deliveryCount: 3, lastAttempt: true });

    expect(logged.mock.calls).toEqual([
      ['notifyOnCreated orders-service.event.OrderCreated.v1 m-1 f-1 attempt 2: card 503'],
      [
        'notifyOnCreated orders-service.event.OrderCreated.v1 m-1 f-1 attempt 3, the last: card 503',
      ],
    ]);
  });

  test('a throw’s fault carries its deliveryCount', async () => {
    const { subscriptions } = receiving(() => {
      throw new Error('gateway down');
    });
    const { deliver, faults } = await consuming({ subscriptions });

    await deliver(created, body, { deliveryCount: 4 });

    expect(faults).toMatchObject([{ kind: 'thrown', deliveryCount: 4, lastAttempt: false }]);
  });

  test('a non-retryable Fault ends it, and onServiceFault receives it as returned, unchanged', async () => {
    const returned = fault({ committed: 'yes', retryable: false, message: 'Card refused' });
    const { subscriptions } = receiving(() => returned);
    const { deliver, faults } = await consuming({ subscriptions });

    const settlement = await deliver(created, body);

    expect(settlement).toBe('ended');
    expect(faults).toEqual([
      {
        declaration: notifyOnCreated,
        name: 'notifyOnCreated',
        subject: created,
        messageId: 'm-1',
        factId: 'f-1',
        deliveryCount: 1,
        lastAttempt: false,
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

    expect(settlement).toBe('pending');
    expect(faults).toEqual([
      {
        declaration: notifyOnCreated,
        name: 'notifyOnCreated',
        subject: created,
        messageId: 'm-1',
        factId: 'f-1',
        deliveryCount: 1,
        lastAttempt: false,
        kind: 'thrown',
        cause: error,
      },
    ]);
  });

  test('a return that is neither nothing nor a Fault leaves it pending, reported as thrown with a TypeError', async () => {
    const { subscriptions } = receiving(() => 'done');
    const { deliver, faults } = await consuming({ subscriptions });

    const settlement = await deliver(created, body);

    expect(settlement).toBe('pending');
    expect(faults).toMatchObject([{ kind: 'thrown', cause: expect.any(TypeError) }]);
  });

  test('a body that fails its Reader ends it without running the Handler, reported as invalid-body with its subject, ids and Issues at body', async () => {
    const { received, subscriptions } = receiving();
    const { deliver, faults } = await consuming({ subscriptions });

    const settlement = await deliver(created, { orderId: 'nope', status: 'paid' });

    expect(settlement).toBe('ended');
    expect(received).toEqual([]);
    expect(faults).toEqual([
      {
        declaration: notifyOnCreated,
        name: 'notifyOnCreated',
        subject: created,
        messageId: 'm-1',
        factId: 'f-1',
        deliveryCount: 1,
        lastAttempt: false,
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

    expect(settlements).toEqual(['ended', 'ended']);
    expect(
      faults.map((consumedFault) => consumedFault.kind === 'invalid-body' && consumedFault.issues),
    ).toEqual([
      [{ part: 'body', path: [], code: 'malformed', message: 'The body is not JSON' }],
      [{ part: 'body', path: [], code: 'malformed', message: 'The body is not JSON' }],
    ]);
  });

  test('onServiceFault receives the Subscription or Command as its declaration, and names a Subscription by its name and a Command as ChargeCard@1', async () => {
    const { deliver, faults } = await consuming();

    await deliver(created, {});
    await deliver(chargeCard, {});

    expect(faults.map(({ declaration, name }) => [declaration, name])).toEqual([
      [notifyOnCreated, 'notifyOnCreated'],
      [chargeCardV2, 'ChargeCard@2'],
    ]);
  });

  test('without onServiceFault, an ended Message is logged one line per Issue with its subject, broker message id and Fact id, never the value', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { broker, deliver } = aBroker();
    const { consume } = await messaging(contract, broker);
    await consume(handlers, {});

    await deliver(created, { orderId: 'secret-value', status: 7 });

    expect(logged.mock.calls).toEqual([
      [
        expect.stringMatching(
          /^notifyOnCreated orders-service\.event\.OrderCreated\.v1 m-1 f-1 attempt 1: body\.orderId invalid_format: /,
        ),
      ],
      [
        expect.stringMatching(
          /^notifyOnCreated orders-service\.event\.OrderCreated\.v1 m-1 f-1 attempt 1: body\.status invalid_value: /,
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
    await consume(
      {
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
      },
      {},
    );

    await deliver(chargeCard, body);
    await deliver(created, body);

    expect(logged.mock.calls).toEqual([
      ['ChargeCard@2 orders-service.command.ChargeCard.v2 m-1 f-1 attempt 1: Card refused', error],
      [
        'notifyOnCreated orders-service.event.OrderCreated.v1 m-1 f-1 attempt 1: the Handler threw',
        error,
      ],
    ]);
  });

  test('an onServiceFault that rejects leaves the delivery pending, receive resolves, and the console gets the onServiceFault threw line with the rejection as cause', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('the hook broke');
    const { broker, deliver } = aBroker();
    const { consume } = await messaging(contract, broker, {
      onServiceFault: async () => {
        throw error;
      },
    });
    await consume(handlers, {});

    const settlement = await deliver(created, {});

    expect(settlement).toBe('pending');
    expect(logged.mock.calls).toEqual([
      [
        'notifyOnCreated orders-service.event.OrderCreated.v1 m-1 f-1 attempt 1: onServiceFault threw',
        error,
      ],
    ]);
  });
});

describe('a Message whose body is nested past the stack', () => {
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
  const nesting = defineService({
    name: 'nesting-service',
    groups: [defineGroup({ name: 'nesting', description: 'Nesting', commands: [nestV1] })],
  });
  const nestReaders = readersOf({
    commands: { nestV1: { declaration: nestV1, reader: tree } },
    subscriptions: {},
  });

  test('is ended as an invalid body with one malformed Issue, and its Handler never runs', async () => {
    const received: unknown[] = [];
    const faults: ConsumedFault[] = [];
    const { broker, deliver } = aBroker();
    const { consume } = await messaging(nesting, broker, {
      onServiceFault: (consumedFault) => {
        faults.push(consumedFault);
      },
    });
    await consume(
      {
        commands: {
          nestV1: handle(nestReaders.commands.nestV1, (given) => {
            received.push(given);
          }),
        },
        subscriptions: {},
        readers: nestReaders,
      },
      {},
    );
    const deep = `${'{"next":'.repeat(5000)}{}${'}'.repeat(5000)}`;

    const settlement = await deliver(
      'nesting-service.command.Nest.v1',
      new TextEncoder().encode(deep),
    );

    expect(settlement).toBe('ended');
    expect(received).toEqual([]);
    expect(faults).toMatchObject([
      {
        kind: 'invalid-body',
        name: 'Nest@1',
        issues: [
          {
            part: 'body',
            path: [],
            code: 'malformed',
            message: 'The value is nested too deeply to read',
          },
        ],
      },
    ]);
  });
});

describe('a Handler’s signal and its delivery’s wait', () => {
  test('the Handler’s signal aborts when close starts, its reason a MessagingClosedError', async () => {
    const stopped = Promise.withResolvers<void>();
    const { signals, subscriptions } = runningUntil(stopped.promise);
    const { deliver, close } = await consuming({ subscriptions });
    const delivered = deliver(created, body);
    signals[0]?.addEventListener('abort', () => stopped.resolve());

    await close();

    await expect(delivered).resolves.toBe('acked');
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[0]?.reason).toBeInstanceOf(MessagingClosedError);
    expect(signals[0]?.reason).toHaveProperty('message', 'messaging is closing');
  });

  test('past the delivery’s waitMs, receive resolves pending without waiting for the Handler, and onServiceFault receives a thrown DeadlineError naming the wait', async () => {
    vi.useFakeTimers();
    const { subscriptions } = runningUntil(never);
    const { deliver, faults } = await consuming({ subscriptions });

    const delivered = deliver(created, body, { waitMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(delivered).resolves.toBe('pending');
    expect(faults).toMatchObject([{ kind: 'thrown', name: 'notifyOnCreated' }]);
    const cause = (faults[0] as { cause: unknown }).cause;
    expect(cause).toBeInstanceOf(DeadlineError);
    expect(cause).toMatchObject({
      name: 'DeadlineError',
      waitMs: 1_000,
      message: "The Handler ran past its delivery's wait of 1000 ms",
    });
  });

  test('past the delivery’s waitMs, the Handler’s signal aborts with the DeadlineError', async () => {
    vi.useFakeTimers();
    const { signals, subscriptions } = runningUntil(never);
    const { deliver, faults } = await consuming({ subscriptions });

    const delivered = deliver(created, body, { waitMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await delivered;

    expect(signals[0]?.aborted).toBe(true);
    expect(signals[0]?.reason).toBe((faults[0] as { cause: unknown }).cause);
  });

  test('a Handler that answers within its waitMs settles as it answered, and its signal never aborts', async () => {
    vi.useFakeTimers();
    const answered = new Promise((resolve) => setTimeout(resolve, 500));
    const { signals, subscriptions } = runningUntil(answered);
    const { deliver, faults } = await consuming({ subscriptions });

    const delivered = deliver(created, body, { waitMs: 1_000 });
    await vi.advanceTimersByTimeAsync(500);
    const settlement = await delivered;
    await vi.advanceTimersByTimeAsync(oneDayMs);

    expect(settlement).toBe('acked');
    expect(faults).toEqual([]);
    expect(signals[0]?.aborted).toBe(false);
  });

  test('a delivery without a waitMs is waited for however long its Handler runs', async () => {
    vi.useFakeTimers();
    const answer = Promise.withResolvers<void>();
    const { subscriptions } = runningUntil(answer.promise);
    const { deliver, faults } = await consuming({ subscriptions });
    const settlements: Settlement[] = [];

    const delivered = deliver(created, body).then((settlement) => settlements.push(settlement));
    await vi.advanceTimersByTimeAsync(oneDayMs);
    const settledWithinOneDay = [...settlements];
    answer.resolve();
    await delivered;

    expect(settledWithinOneDay).toEqual([]);
    expect(settlements).toEqual(['acked']);
    expect(faults).toEqual([]);
  });

  const events = ['answer', 'wait', 'close'] as const;
  const orders = events.flatMap((first) =>
    events
      .filter((second) => second !== first)
      .map((second) => [
        first,
        second,
        events.find((third) => third !== first && third !== second),
      ]),
  ) as (readonly (typeof events)[number][])[];
  const firstOf = {
    answer: { settlement: 'pending', faults: [['thrown', 'Error']] },
    wait: { settlement: 'pending', faults: [['thrown', 'DeadlineError']] },
    close: { settlement: 'handed-back', faults: [] },
  };

  test.each(orders)(
    'a delivery settles once, by whichever comes first of its Handler throwing, its wait passing and close’s signal aborting: %s, then %s, then %s',
    async (...order) => {
      vi.useFakeTimers();
      const answer = Promise.withResolvers<void>();
      const { subscriptions } = runningUntil(answer.promise);
      const { deliver, faults, close } = await consuming({ subscriptions });
      const settlements: Settlement[] = [];
      const delivered = deliver(created, body, { waitMs: 1_000 }).then((settlement) =>
        settlements.push(settlement),
      );
      const stopping = new AbortController();
      const closing = close({ signal: stopping.signal }).catch(() => undefined);
      const happen = {
        answer: () => answer.reject(new Error('the database is down')),
        wait: () => vi.advanceTimersByTimeAsync(1_000),
        close: () => stopping.abort(),
      };

      for (const event of order) {
        await happen[event]();
        await vi.advanceTimersByTimeAsync(0);
      }
      await Promise.all([delivered, closing]);

      const expected = firstOf[order[0] as (typeof events)[number]];
      expect(settlements).toEqual([expected.settlement]);
      const reported = faults.map((fault) => [fault.kind, (fault as { cause: Error }).cause.name]);
      expect(reported).toEqual(expected.faults);
    },
  );

  test.each([
    ['1 ms', 1],
    ['2,147,483,647 ms', 2_147_483_647],
    ['2,147,483,648 ms', 2_147_483_648],
    ['30 days', 30 * oneDayMs],
    ['one year', 365 * oneDayMs],
  ])(
    'a Handler is waited for its whole wait and no longer, however long the wait: %s',
    async (_name, waitMs) => {
      vi.useFakeTimers();
      const { subscriptions } = runningUntil(never);
      const { deliver } = await consuming({ subscriptions });
      const settlements: Settlement[] = [];

      const delivered = deliver(created, body, { waitMs }).then((settlement) =>
        settlements.push(settlement),
      );
      await vi.advanceTimersByTimeAsync(waitMs - 1);
      const settledBefore = [...settlements];
      await vi.advanceTimersByTimeAsync(1);
      await delivered;

      expect(settledBefore).toEqual([]);
      expect(settlements).toEqual(['pending']);
    },
  );

  test('a delivery close({ signal }) hands back leaves no wait timer behind', async () => {
    vi.useFakeTimers();
    const { subscriptions } = runningUntil(never);
    const { deliver, close } = await consuming({ subscriptions });
    const delivered = deliver(created, body, { waitMs: 30_000 });

    await close({ signal: AbortSignal.abort() }).catch(() => undefined);

    await expect(delivered).resolves.toBe('handed-back');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a Handler that answers within its wait is not cut short by a slow onServiceFault: one Fault, settled as it answered', async () => {
    vi.useFakeTimers();
    const hook = Promise.withResolvers<void>();
    const told: ConsumedFault[] = [];
    const signals: AbortSignal[] = [];
    const refusing = handle(readers.subscriptions.notifyOnCreated, (_body, meta) => {
      signals.push(meta.signal);
      return fault({ committed: 'no', retryable: false });
    });
    const { deliver } = await consuming(
      { subscriptions: { notifyOnCreated: refusing } },
      {
        onServiceFault: async (consumedFault) => {
          told.push(consumedFault);
          await hook.promise;
        },
      },
    );

    const delivered = deliver(created, body, { waitMs: 1_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    const abortedWhileTelling = signals[0]?.aborted;
    hook.resolve();

    await expect(delivered).resolves.toBe('ended');
    expect(told.map(({ kind }) => kind)).toEqual(['returned']);
    expect(abortedWhileTelling).toBe(false);
  });
});
