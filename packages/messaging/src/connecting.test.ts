import {
  defineApplication,
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
} from '@cf-loom/contract';
import { handle, readersOf } from '@cf-loom/handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import {
  type Broker,
  type BrokerConsumer,
  type BrokerService,
  type BrokerTrouble,
  CloseAbortedError,
  type ConsumeRun,
  type Delivery,
  MessageNotSentError,
  type Messaging,
  MessagingClosedError,
  messaging,
  type OutgoingMessage,
  type Settlement,
} from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const orderBody = z.object({ orderId: z.uuid() });

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
  description: 'Charges the order’s card',
  body: orderBody,
});

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV1,
});

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1],
      commands: [chargeCardV1],
      subscriptions: [notifyOnCreated],
    }),
  ],
});

const readers = readersOf({
  commands: { chargeCardV1: { element: chargeCardV1, reader: orderBody } },
  subscriptions: { notifyOnCreated: { element: notifyOnCreated, reader: orderBody } },
});

const handlers = {
  commands: { chargeCardV1: handle(readers.commands.chargeCardV1, () => undefined) },
  subscriptions: {
    notifyOnCreated: handle(readers.subscriptions.notifyOnCreated, () => undefined),
  },
  readers,
};

const body = { orderId: ORDER_ID };

type Opened = Messaging<typeof contract>;

afterEach(() => {
  vi.restoreAllMocks();
});

/** A broker that records what messaging asks of it, built on the public `Broker` type. */
function aBroker(failing: { readonly connect?: Error; readonly consumes?: number } = {}) {
  const recorded = {
    connectedWith: [] as BrokerService[],
    published: [] as OutgoingMessage[],
    consumers: [] as BrokerConsumer[],
    runs: [] as ConsumeRun[],
    consumes: 0,
    closes: 0,
  };
  const broker: Broker = {
    connect: async (service) => {
      recorded.connectedWith.push(service);
      if (failing.connect !== undefined) {
        throw failing.connect;
      }
      return {
        publish: async (message) => {
          recorded.published.push(message);
          return { duplicate: false };
        },
        consume: async (consumers, run) => {
          recorded.consumes += 1;
          recorded.runs.push(run);
          if (recorded.consumes <= (failing.consumes ?? 0)) {
            throw new Error('no such durable consumer');
          }
          recorded.consumers.push(...consumers);
        },
        close: async () => {
          recorded.closes += 1;
        },
      };
    },
  };
  const deliver = (
    subject: string,
    delivered: unknown,
    delivery: Partial<Delivery> = {},
  ): Promise<Settlement> => {
    const consumer = recorded.consumers.find((candidate) => candidate.subject === subject);
    if (consumer === undefined) {
      throw new Error(`Nothing consumes ${subject}`);
    }
    return consumer.receive({ ...aDelivery(delivered), ...delivery });
  };
  return { broker, recorded, deliver };
}

function aDelivery(delivered: unknown): Delivery {
  const bytes = new TextEncoder().encode(JSON.stringify(delivered));
  const meta = { messageId: 'm-1', factId: 'f-1', deliveryCount: 1, lastAttempt: false };
  return { ...meta, waitMs: undefined, headers: {}, body: bytes };
}

/** A promise a test settles itself, to hold a Handler while it runs. */
function aGate() {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** A broker that logs each call it starts and ends, holding `publish` and `consume` on the gates given. */
function aLoggingBroker(held: {
  readonly publish?: Promise<void>;
  readonly consume?: Promise<void>;
}) {
  const log: string[] = [];
  const consumers: BrokerConsumer[] = [];
  const broker: Broker = {
    connect: async () => ({
      publish: async () => {
        log.push('publish');
        await held.publish;
        log.push('published');
        return { duplicate: false };
      },
      consume: async (given) => {
        consumers.push(...given);
        log.push('consume');
        await held.consume;
        log.push('consumed');
      },
      close: async () => {
        log.push('close');
        await Promise.resolve();
        log.push('closed');
      },
    }),
  };
  return { broker, log, consumers };
}

/** A messaging consuming, whose `notifyOnCreated` Handler is the one given. */
async function consumingWith(notifying: (typeof handlers.subscriptions)['notifyOnCreated']) {
  const recording = aBroker();
  const opened = await messaging(contract, recording.broker);
  await opened.consume({ ...handlers, subscriptions: { notifyOnCreated: notifying } });
  return { ...recording, ...opened };
}

describe('messaging() and close', () => {
  test('connect receives the Service’s stream and subjects, unprefixed', async () => {
    const { broker, recorded } = aBroker();

    await messaging(contract, broker);

    expect(recorded.connectedWith).toEqual([
      {
        stream: 'orders-service',
        subjects: ['orders-service.event.OrderCreated.v1', 'orders-service.command.ChargeCard.v1'],
      },
    ]);
  });

  test('the subjects the broker is told leave out Retired Event versions and Command versions that are not Active', async () => {
    const orderCreated = (version: number, lifecycle?: 'deprecated' | 'retired') =>
      defineEvent({
        name: 'OrderCreated',
        version,
        visibility: 'internal',
        ...(lifecycle === undefined ? {} : { lifecycle }),
        description: 'An order was created',
        body: orderBody,
      });
    const chargeCard = (version: number, lifecycle?: 'deprecated') =>
      defineCommand({
        name: 'ChargeCard',
        version,
        ...(lifecycle === undefined ? {} : { lifecycle }),
        description: 'Charges the order’s card',
        body: orderBody,
      });
    const evolved = defineService({
      name: 'orders-service',
      groups: [
        defineGroup({
          name: 'messages',
          description: 'Messages',
          events: [orderCreated(3), orderCreated(1, 'retired'), orderCreated(2, 'deprecated')],
          commands: [chargeCard(1, 'deprecated'), chargeCard(2)],
        }),
      ],
    });
    const { broker, recorded } = aBroker();

    await messaging(evolved, broker);

    expect(recorded.connectedWith[0]?.subjects).toEqual([
      'orders-service.event.OrderCreated.v2',
      'orders-service.event.OrderCreated.v3',
      'orders-service.command.ChargeCard.v2',
    ]);
  });

  test('messaging() given something that is no Service’s Contract rejects and connects nothing', async () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [] });
    const { broker, recorded } = aBroker();

    const opening = messaging(application as never, broker);

    await expect(opening).rejects.toThrow(
      "messaging() takes a Service's Contract declared with defineService",
    );
    expect(recorded.connectedWith).toEqual([]);
  });

  test('a Subscription whose Event neither a Group lists nor another Service’s Contract Package exports rejects messaging(), naming it', async () => {
    const notifying = defineGroup({
      name: 'notifications',
      description: 'Notifications',
      subscriptions: [notifyOnCreated],
    });
    const unlisted = defineService({ name: 'orders-service', groups: [notifying] });

    const opening = messaging(unlisted, aBroker().broker);

    await expect(opening).rejects.toThrow(
      "notifyOnCreated subscribes to an Event neither a Group lists nor another Service's Contract Package exports",
    );
  });

  test('a broker that fails to connect rejects messaging() with its error', async () => {
    const error = new Error('no route to the broker');

    const opening = messaging(contract, aBroker({ connect: error }).broker);

    await expect(opening).rejects.toBe(error);
  });

  test('each messaging() is its own connection: closing one leaves the other open', async () => {
    const { broker, recorded } = aBroker();
    const first = await messaging(contract, broker);
    const second = await messaging(contract, broker);

    await first.close();
    await second.publisher.publish('OrderCreated', { v1: body }, { factId: 'f-1' });

    expect(recorded.connectedWith).toHaveLength(2);
    expect(recorded.closes).toBe(1);
    expect(recorded.published).toHaveLength(1);
  });

  test('close waits for the Handlers running before it closes the connection', async () => {
    const gate = aGate();
    const notifying = handle(readers.subscriptions.notifyOnCreated, async () => {
      await gate.opened;
    });
    const { recorded, deliver, close } = await consumingWith(notifying);
    const delivered = deliver('orders-service.event.OrderCreated.v1', body);

    const closing = close();
    await Promise.resolve();
    const closesWhileRunning = recorded.closes;
    gate.open();
    await closing;

    expect(closesWhileRunning).toBe(0);
    expect(recorded.closes).toBe(1);
    await expect(delivered).resolves.toBe('acked');
  });

  test('a Handler running during close can still publish', async () => {
    const gate = aGate();
    let publish = (): Promise<unknown> => Promise.resolve();
    const notifying = handle(readers.subscriptions.notifyOnCreated, async () => {
      await gate.opened;
      await publish();
    });
    const { recorded, deliver, close, publisher } = await consumingWith(notifying);
    publish = () => publisher.publish('OrderCreated', { v1: body }, { factId: 'f-2' });
    const delivered = deliver('orders-service.event.OrderCreated.v1', body);

    const closing = close();
    gate.open();
    await closing;

    await expect(delivered).resolves.toBe('acked');
    expect(recorded.published).toHaveLength(1);
  });

  test('a Message delivered while closing is left pending and its Handler never runs', async () => {
    const gate = aGate();
    const runs: unknown[] = [];
    const notifying = handle(readers.subscriptions.notifyOnCreated, async (given) => {
      runs.push(given);
      await gate.opened;
    });
    const { deliver, close } = await consumingWith(notifying);
    const first = deliver('orders-service.event.OrderCreated.v1', body);
    const closing = close();

    const second = await deliver('orders-service.event.OrderCreated.v1', body);
    gate.open();
    await Promise.all([first, closing]);

    expect(second).toBe('pending');
    expect(runs).toHaveLength(1);
  });

  test.each([
    [
      'publish',
      (opened: Opened) => opened.publisher.publish('OrderCreated', { v1: body }, { factId: 'f-3' }),
    ],
    ['send', (opened: Opened) => opened.sender.send('ChargeCard', body, { factId: 'f-4' })],
  ])('close waits for a %s in flight before it closes the connection', async (_name, call) => {
    const gate = aGate();
    const { broker, log } = aLoggingBroker({ publish: gate.opened });
    const opened = await messaging(contract, broker);
    const sending = call(opened);

    const closing = opened.close();
    gate.open();
    await Promise.all([sending, closing]);

    expect(log).toEqual(['publish', 'published', 'close', 'closed']);
  });

  test.each([
    ['right after it', async (publish: () => Promise<unknown>) => publish()],
    [
      'after one more await',
      async (publish: () => Promise<unknown>) => {
        await Promise.resolve();
        await publish();
      },
    ],
  ])(
    'a publish chained %s, once close waited for the one in flight, throws messaging is closed',
    async (_name, chain) => {
      const gate = aGate();
      const { broker, log } = aLoggingBroker({ publish: gate.opened });
      const { publisher, close } = await messaging(contract, broker);
      const publish = () => publisher.publish('OrderCreated', { v1: body }, { factId: 'f-5' });
      const chained = (async () => {
        await publish();
        await chain(publish);
      })();

      const closing = close();
      gate.open();
      await closing;

      await expect(chained).rejects.toThrow('messaging is closed');
      expect(log).toEqual(['publish', 'published', 'close', 'closed']);
    },
  );

  test('a Handler running during close that publishes twice is waited for, both publishes included', async () => {
    const gate = aGate();
    const { broker, log, consumers } = aLoggingBroker({ publish: gate.opened });
    let publish = (): Promise<unknown> => Promise.resolve();
    const notifying = handle(readers.subscriptions.notifyOnCreated, async () => {
      await publish();
      await publish();
    });
    const { publisher, consume, close } = await messaging(contract, broker);
    publish = () => publisher.publish('OrderCreated', { v1: body }, { factId: 'f-6' });
    await consume({ ...handlers, subscriptions: { notifyOnCreated: notifying } });
    const consumer = consumers.find(
      (candidate) => candidate.subject === 'orders-service.event.OrderCreated.v1',
    );
    const delivered = consumer?.receive(aDelivery(body));

    const closing = close();
    gate.open();
    await closing;

    await expect(delivered).resolves.toBe('acked');
    expect(log).toEqual([
      'consume',
      'consumed',
      'publish',
      'published',
      'publish',
      'published',
      'close',
      'closed',
    ]);
  });

  test('close aborts the signal consume handed the broker as soon as it starts, before the Handlers running finish', async () => {
    const gate = aGate();
    const notifying = handle(readers.subscriptions.notifyOnCreated, async () => {
      await gate.opened;
    });
    const { recorded, deliver, close } = await consumingWith(notifying);
    const delivered = deliver('orders-service.event.OrderCreated.v1', body);
    const abortedBeforeClose = recorded.runs.map(({ closing }) => closing.aborted);

    const closing = close();
    const abortedWhileRunning = recorded.runs.map((run) => run.closing.aborted);
    gate.open();
    await Promise.all([delivered, closing]);

    expect(abortedBeforeClose).toEqual([false]);
    expect(abortedWhileRunning).toEqual([true]);
  });

  test('close waits for a consume in flight before it closes the connection', async () => {
    const gate = aGate();
    const { broker, log } = aLoggingBroker({ consume: gate.opened });
    const { consume, close } = await messaging(contract, broker);
    const consuming = consume(handlers);

    const closing = close();
    gate.open();
    await Promise.all([consuming, closing]);

    expect(log).toEqual(['consume', 'consumed', 'close', 'closed']);
  });

  test('a consume called while another is with the broker throws, and the broker consumes once', async () => {
    const gate = aGate();
    const { broker, log } = aLoggingBroker({ consume: gate.opened });
    const { consume } = await messaging(contract, broker);
    const first = consume(handlers);

    const second = consume(handlers);
    gate.open();
    await first;

    await expect(second).rejects.toThrow('consume() was already called on this messaging');
    expect(log.filter((call) => call === 'consume')).toHaveLength(1);
  });

  test('close called twice returns the same promise and closes the connection once', async () => {
    const { broker, recorded } = aBroker();
    const { close } = await messaging(contract, broker);

    const closings = [close(), close()];
    await Promise.all(closings);
    await close();

    expect(closings[1]).toBe(closings[0]);
    expect(recorded.closes).toBe(1);
  });

  test.each([
    [
      'publishing',
      (opened: Opened) => opened.publisher.publish('OrderCreated', { v1: body }, { factId: 'f-7' }),
    ],
    ['sending', (opened: Opened) => opened.sender.send('ChargeCard', body, { factId: 'f-8' })],
    ['consuming', (opened: Opened) => opened.consume(handlers)],
  ])(
    '%s after close throws messaging is closed, and nothing reaches the broker',
    async (_name, call) => {
      const { broker, recorded } = aBroker();
      const opened = await messaging(contract, broker);
      await opened.close();

      const calling = call(opened);

      await expect(calling).rejects.toThrow('messaging is closed');
      expect(recorded.published).toEqual([]);
      expect(recorded.consumes).toBe(0);
    },
  );

  test('a broker close that rejects rejects every close() call with its error', async () => {
    const error = new Error('the broker hung up');
    const broker: Broker = {
      connect: async () => ({
        publish: async () => ({ duplicate: false }),
        consume: async () => undefined,
        close: async () => {
          throw error;
        },
      }),
    };
    const { close } = await messaging(contract, broker);

    const closings = [close(), close()];

    await expect(closings[0]).rejects.toBe(error);
    await expect(closings[1]).rejects.toBe(error);
  });

  test('a publish in flight that the broker rejects while closing still lets close resolve, closing the connection once', async () => {
    const gate = aGate();
    const rejected = gate.opened.then(() => Promise.reject(new Error('broker down')));
    const { broker, log } = aLoggingBroker({ publish: rejected });
    const { publisher, close } = await messaging(contract, broker);
    const publishing = publisher.publish('OrderCreated', { v1: body }, { factId: 'f-9' });

    const closing = close();
    gate.open();
    await closing;

    await expect(publishing).rejects.toBeInstanceOf(MessageNotSentError);
    expect(log.filter((call) => call === 'close')).toHaveLength(1);
  });

  test('a publish called right after close with nothing in flight throws messaging is closed and publishes nothing', async () => {
    const { broker, log } = aLoggingBroker({});
    const { publisher, close } = await messaging(contract, broker);
    const closing = close();

    const publishing = publisher.publish('OrderCreated', { v1: body }, { factId: 'f-10' });
    await closing;

    await expect(publishing).rejects.toThrow('messaging is closed');
    expect(log).not.toContain('publish');
  });

  test('consume while closing throws MessagingClosedError, and the broker consumes nothing', async () => {
    const gate = aGate();
    const { broker, log } = aLoggingBroker({ publish: gate.opened });
    const { consume, close, publisher } = await messaging(contract, broker);
    const publishing = publisher.publish('OrderCreated', { v1: body }, { factId: 'f-11' });
    const closing = close();

    const consuming = consume(handlers);
    gate.open();
    await Promise.all([publishing, closing]);

    await expect(consuming).rejects.toThrow('messaging is closing');
    await expect(consuming).rejects.toBeInstanceOf(MessagingClosedError);
    expect(log).not.toContain('consume');
  });

  test('a Broker adapter’s duplicate reaches send', async () => {
    const broker: Broker = {
      connect: async () => ({
        publish: async () => ({ duplicate: true }),
        consume: async () => undefined,
        close: async () => undefined,
      }),
    };
    const { sender } = await messaging(contract, broker);

    const sent = await sender.send('ChargeCard', body, { factId: 'o-1:charge' });

    expect(sent).toEqual({ factId: 'o-1:charge', duplicate: true });
  });

  test('a consume the broker rejects can be retried', async () => {
    const { broker, recorded } = aBroker({ consumes: 1 });
    const { consume } = await messaging(contract, broker);
    const failed = await consume(handlers).catch((e: unknown) => e);

    await consume(handlers);

    expect(failed).toEqual(new Error('no such durable consumer'));
    expect(recorded.consumers).toHaveLength(2);
  });

  test('the functions messaging() returns work destructured', async () => {
    const { broker, recorded } = aBroker();
    const { consume, close, publisher, sender } = await messaging(contract, broker);
    const { publish } = publisher;
    const { send } = sender;

    await consume(handlers);
    await publish('OrderCreated', { v1: body }, { factId: 'f-13' });
    await send('ChargeCard', body, { factId: 'f-14' });
    await close();

    expect(recorded.published).toHaveLength(2);
    expect(recorded.consumers).toHaveLength(2);
    expect(recorded.closes).toBe(1);
  });
});

/** A messaging consuming with the hooks given, the broker's records, and the consumer of `notifyOnCreated` its adapter reports on. */
async function consumingReported(options: Parameters<typeof messaging>[2] = {}) {
  const recording = aBroker();
  const opened = await messaging(contract, recording.broker, options);
  await opened.consume(handlers);
  const notifying = recording.recorded.consumers.find(
    (consumer) => consumer.subject === 'orders-service.event.OrderCreated.v1',
  ) as BrokerConsumer;
  const troubled = (recording.recorded.runs[0] as ConsumeRun).troubled;
  return { ...recording, ...opened, notifying, troubled };
}

describe('onBrokerTrouble', () => {
  test('a consumer the adapter reports failing reaches onBrokerTrouble with its Element, identity, durable consumer, stream and cause', async () => {
    const troubles: BrokerTrouble[] = [];
    const { notifying, troubled } = await consumingReported({
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });
    const cause = new Error('NATS answered a pull with 503');

    troubled({ consumer: notifying, kind: 'pull-failed', cause });

    await vi.waitFor(() => expect(troubles).toHaveLength(1));
    expect(troubles).toEqual([
      {
        element: notifyOnCreated,
        identity: 'notifyOnCreated',
        durable: 'orders-service_notify-on-created',
        stream: 'orders-service',
        kind: 'pull-failed',
        cause,
      },
    ]);
  });

  test('a recovery reaches onBrokerTrouble as recovered', async () => {
    const troubles: BrokerTrouble[] = [];
    const { notifying, troubled } = await consumingReported({
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });

    troubled({ consumer: notifying, kind: 'pull-failed', cause: new Error('503') });
    troubled({ consumer: notifying, kind: 'recovered' });

    await vi.waitFor(() => expect(troubles).toHaveLength(2));
    expect(troubles[1]).toEqual({
      element: notifyOnCreated,
      identity: 'notifyOnCreated',
      durable: 'orders-service_notify-on-created',
      stream: 'orders-service',
      kind: 'recovered',
    });
  });

  test('without onBrokerTrouble, a failing consumer is one console line with its cause, and a recovery another', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { notifying, troubled, close } = await consumingReported();
    const cause = new Error('NATS answered a pull with 503');

    troubled({ consumer: notifying, kind: 'pull-failed', cause });
    troubled({ consumer: notifying, kind: 'recovered' });
    await close();

    expect(logged.mock.calls).toEqual([
      ['notifyOnCreated orders-service_notify-on-created orders-service: pulls are failing', cause],
      ['notifyOnCreated orders-service_notify-on-created orders-service: pulls are answered again'],
    ]);
  });

  test('an onBrokerTrouble that rejects is logged with its onBrokerTrouble threw line, and the next report still reaches it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new Error('the alerting is down');
    const kinds: string[] = [];
    const { notifying, troubled, close } = await consumingReported({
      onBrokerTrouble: async ({ kind }) => {
        kinds.push(kind);
        throw error;
      },
    });

    troubled({ consumer: notifying, kind: 'pull-failed', cause: new Error('503') });
    troubled({ consumer: notifying, kind: 'recovered' });
    await close();

    expect(kinds).toEqual(['pull-failed', 'recovered']);
    expect(logged).toHaveBeenCalledWith(
      'notifyOnCreated orders-service_notify-on-created orders-service: onBrokerTrouble threw',
      error,
    );
  });

  test('close waits for an onBrokerTrouble in flight', async () => {
    const gate = aGate();
    const { notifying, troubled, close, recorded } = await consumingReported({
      onBrokerTrouble: () => gate.opened,
    });
    troubled({ consumer: notifying, kind: 'pull-failed', cause: new Error('503') });

    const closing = close();
    await Promise.resolve();
    const closesWhileReporting = recorded.closes;
    gate.open();
    await closing;

    expect(closesWhileReporting).toBe(0);
    expect(recorded.closes).toBe(1);
  });

  test('a report the adapter makes once close started never reaches onBrokerTrouble', async () => {
    const troubles: BrokerTrouble[] = [];
    const { notifying, troubled, close } = await consumingReported({
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });

    const closing = close();
    troubled({ consumer: notifying, kind: 'pull-failed', cause: new Error('503') });
    await closing;
    troubled({ consumer: notifying, kind: 'recovered' });

    expect(troubles).toEqual([]);
  });

  test('troubled given a copy of a consumer the core handed it reaches onBrokerTrouble named as that consumer', async () => {
    const troubles: BrokerTrouble[] = [];
    const { recorded, troubled } = await consumingReported({
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });
    const copies: readonly ((consumer: BrokerConsumer) => BrokerConsumer)[] = [
      (consumer) => ({ ...consumer }),
      (consumer) => ({ ...consumer, receive: (delivery) => consumer.receive(delivery) }),
    ];

    for (const consumer of recorded.consumers) {
      for (const copy of copies) {
        troubled({ consumer: copy(consumer), kind: 'recovered' });
      }
    }

    const named = (element: object, identity: string, durable: string) =>
      Array.from({ length: copies.length }, () => ({
        element,
        identity,
        durable,
        stream: 'orders-service',
        kind: 'recovered',
      }));
    await vi.waitFor(() => expect(troubles).toHaveLength(4));
    expect(troubles).toEqual([
      ...named(chargeCardV1, 'ChargeCard@1', 'orders-service_command_ChargeCard_v1'),
      ...named(notifyOnCreated, 'notifyOnCreated', 'orders-service_notify-on-created'),
    ]);
  });

  test('troubled given a Durable consumer the core did not hand this consume throws, naming it, and reaches no hook', async () => {
    const troubles: BrokerTrouble[] = [];
    const { troubled, close } = await consumingReported({
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });
    const stranger: BrokerConsumer = {
      durable: 'billing-service_notify-on-created',
      stream: 'orders-service',
      subject: 'orders-service.event.OrderCreated.v1',
      receive: async () => 'acked',
    };

    const reporting = () => troubled({ consumer: stranger, kind: 'recovered' });

    expect(reporting).toThrow(
      new Error(
        'billing-service_notify-on-created is no Durable consumer messaging handed this Broker',
      ),
    );
    await close();
    expect(troubles).toEqual([]);
  });
});

type ListenerSpy = { readonly mock: { readonly calls: unknown[][]; readonly contexts: unknown[] } };

/** The most abort listeners any AbortSignal still holds, from the calls the spies on `addEventListener` and `removeEventListener` saw. */
function abortListenersLeft(added: ListenerSpy, removed: ListenerSpy): number {
  const listening = new Map<AbortSignal, number>();
  for (const [spy, step] of [
    [added, 1],
    [removed, -1],
  ] as const) {
    spy.mock.calls.forEach(([type], call) => {
      const target = spy.mock.contexts[call];
      if (type === 'abort' && target instanceof AbortSignal) {
        listening.set(target, (listening.get(target) ?? 0) + step);
      }
    });
  }
  return Math.max(0, ...listening.values());
}

describe('close and a Handler’s wait', () => {
  const created = 'orders-service.event.OrderCreated.v1';

  /** A Handler of `notifyOnCreated` that never answers. */
  const neverAnswering = handle(
    readers.subscriptions.notifyOnCreated,
    () => new Promise(() => undefined),
  );

  test('close does not wait for a Handler past its wait', async () => {
    const { recorded, deliver, close } = await consumingWith(neverAnswering);
    const delivered = deliver(created, body, { waitMs: 20 });

    await close();

    await expect(delivered).resolves.toBe('pending');
    expect(recorded.closes).toBe(1);
  });

  test('close({ signal }) with a Handler that never settles hands its Message back, closes the connection and rejects with CloseAbortedError naming it', async () => {
    const { recorded, deliver, close } = await consumingWith(neverAnswering);
    const delivered = deliver(created, body);
    const stopping = new AbortController();
    const reason = new Error('the grace period is over');

    const closing = close({ signal: stopping.signal });
    stopping.abort(reason);

    const error = await closing.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloseAbortedError);
    expect(error).toMatchObject({
      name: 'CloseAbortedError',
      message: `close stopped waiting and handed back 1 Message: notifyOnCreated ${created} m-1 f-1`,
      handedBack: [
        { identity: 'notifyOnCreated', subject: created, messageId: 'm-1', factId: 'f-1' },
      ],
      cause: reason,
    });
    await expect(delivered).resolves.toBe('handed-back');
    expect(recorded.closes).toBe(1);
  });

  test('close({ signal }) with two Handlers that never settle hands back and names both', async () => {
    const { deliver, close } = await consumingWith(neverAnswering);
    const first = deliver(created, body);
    const second = deliver(created, body, { messageId: 'm-2', factId: 'f-2' });

    const error = await close({ signal: AbortSignal.abort() }).catch((e: unknown) => e);

    expect(error).toMatchObject({
      handedBack: [
        { identity: 'notifyOnCreated', subject: created, messageId: 'm-1', factId: 'f-1' },
        { identity: 'notifyOnCreated', subject: created, messageId: 'm-2', factId: 'f-2' },
      ],
    });
    expect(await Promise.all([first, second])).toEqual(['handed-back', 'handed-back']);
  });

  test('close({ signal }) names a delivery as handed back exactly when it settled handed-back, however close to its answer the signal aborts', async () => {
    const rows: string[] = [];
    for (let ticks = 0; ticks < 25; ticks += 1) {
      const gate = aGate();
      const answering = handle(readers.subscriptions.notifyOnCreated, () =>
        gate.opened.then(() => undefined),
      );
      const { deliver, close } = await consumingWith(answering);
      const delivered = deliver(created, body);
      await Promise.resolve();
      const stopping = new AbortController();
      const closing = close({ signal: stopping.signal });
      gate.open();
      for (let tick = 0; tick < ticks; tick += 1) {
        await Promise.resolve();
      }
      stopping.abort();
      const named = await closing.then(
        () => 0,
        (e: unknown) => (e as CloseAbortedError).handedBack.length,
      );
      const settlement = await delivered;
      rows.push(`${settlement}:${named}`);
    }

    const misnamed = rows.filter((row) => row === 'acked:1' || row === 'handed-back:0');
    expect(misnamed).toEqual([]);
  });

  test('close({ signal }) with nothing running resolves as close does', async () => {
    const { recorded, close } = await consumingWith(neverAnswering);
    const stopping = new AbortController();

    const closing = close({ signal: stopping.signal });
    stopping.abort();

    await expect(closing).resolves.toBeUndefined();
    expect(recorded.closes).toBe(1);
  });

  test('a signal already aborted makes close hand back at once', async () => {
    const { recorded, deliver, close } = await consumingWith(neverAnswering);
    const delivered = deliver(created, body);

    const closing = close({ signal: AbortSignal.abort() });

    await expect(closing).rejects.toBeInstanceOf(CloseAbortedError);
    await expect(delivered).resolves.toBe('handed-back');
    expect(recorded.closes).toBe(1);
  });

  test('a second close call’s signal bounds the closing the first started', async () => {
    const { recorded, deliver, close } = await consumingWith(neverAnswering);
    const delivered = deliver(created, body);
    const stopping = new AbortController();
    const first = close();

    const second = close({ signal: stopping.signal });
    stopping.abort();

    expect(second).toBe(first);
    await expect(first).rejects.toBeInstanceOf(CloseAbortedError);
    await expect(delivered).resolves.toBe('handed-back');
    expect(recorded.closes).toBe(1);
  });

  test('deliveries that settled and a close that handed back leave no abort listener behind, on closing, the hand-back or close’s signal', async () => {
    const added = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const removed = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    let calls = 0;
    const answeringThrice = handle(readers.subscriptions.notifyOnCreated, () => {
      calls += 1;
      return calls <= 3 ? undefined : new Promise<undefined>(() => undefined);
    });
    const { deliver, close } = await consumingWith(answeringThrice);
    for (const _call of [1, 2, 3]) {
      await deliver(created, body, { waitMs: 30_000 });
    }
    const held = deliver(created, body, { waitMs: 30_000 });
    const stopping = new AbortController();

    const closing = close({ signal: stopping.signal });
    stopping.abort();
    await closing.catch(() => undefined);
    await held;

    expect(abortListenersLeft(added, removed)).toBe(0);
  });

  test('a publish in flight when close’s signal aborts is not waited for', async () => {
    const gate = aGate();
    const { broker, log } = aLoggingBroker({ publish: gate.opened });
    const { publisher, close } = await messaging(contract, broker);
    const publishing = publisher.publish('OrderCreated', { v1: body }, { factId: 'f-15' });
    const stopping = new AbortController();

    const closing = close({ signal: stopping.signal });
    stopping.abort();
    await closing;
    const loggedAtClose = [...log];
    gate.open();
    await publishing;

    expect(loggedAtClose).toEqual(['publish', 'close', 'closed']);
  });

  test('an onServiceFault in flight when close’s signal aborts is not waited for, and its delivery is handed back', async () => {
    const throwing = handle(readers.subscriptions.notifyOnCreated, () => {
      throw new Error('the database is down');
    });
    const recording = aBroker();
    const { consume, close } = await messaging(contract, recording.broker, {
      onServiceFault: () => new Promise(() => undefined),
    });
    await consume({ ...handlers, subscriptions: { notifyOnCreated: throwing } });
    const delivered = recording.deliver(created, body);
    const stopping = new AbortController();

    const closing = close({ signal: stopping.signal });
    stopping.abort();

    await expect(closing).rejects.toBeInstanceOf(CloseAbortedError);
    await expect(delivered).resolves.toBe('handed-back');
    expect(recording.recorded.closes).toBe(1);
  });
});
