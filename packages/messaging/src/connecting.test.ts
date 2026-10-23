import {
  defineApplication,
  defineCommand,
  defineContract,
  defineEvent,
  defineSubscription,
} from '@cf-loom/contract';
import { handle, withReader } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type Broker,
  type BrokerConsumer,
  type BrokerService,
  type Delivery,
  type Messaging,
  messaging,
  type OutgoingMessage,
  PublishError,
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

const notifyOnCreated = defineSubscription({ name: 'notify-on-created', event: orderCreatedV1 });

const contract = defineContract({
  name: 'orders-service',
  events: [orderCreatedV1],
  commands: [chargeCardV1],
  subscriptions: [notifyOnCreated],
});

const handlers = {
  commands: { chargeCardV1: handle(withReader(chargeCardV1, orderBody), () => undefined) },
  subscriptions: {
    'notify-on-created': handle(withReader(notifyOnCreated, orderBody), () => undefined),
  },
};

const body = { orderId: ORDER_ID };

type Opened = Messaging<typeof contract>;

/** A broker that records what messaging asks of it, built on the public `Broker` type. */
function aBroker(failing: { readonly connect?: Error; readonly consumes?: number } = {}) {
  const recorded = {
    connectedWith: [] as BrokerService[],
    published: [] as OutgoingMessage[],
    consumers: [] as BrokerConsumer[],
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
        },
        consume: async (consumers) => {
          recorded.consumes += 1;
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
  const deliver = (subject: string, delivered: unknown): Promise<Settlement> => {
    const consumer = recorded.consumers.find((candidate) => candidate.subject === subject);
    if (consumer === undefined) {
      throw new Error(`Nothing consumes ${subject}`);
    }
    return consumer.receive(aDelivery(delivered));
  };
  return { broker, recorded, deliver };
}

function aDelivery(delivered: unknown): Delivery {
  const bytes = new TextEncoder().encode(JSON.stringify(delivered));
  return { messageId: 'm-1', factId: 'f-1', deliveryCount: 1, headers: {}, body: bytes };
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

/** A messaging consuming, whose `notify-on-created` Handler is the one given. */
async function consumingWith(notifying: (typeof handlers.subscriptions)['notify-on-created']) {
  const recording = aBroker();
  const opened = await messaging(contract, recording.broker);
  await opened.consume({ ...handlers, subscriptions: { 'notify-on-created': notifying } });
  return { ...recording, ...opened };
}

describe('messaging() and close', () => {
  test('messaging() connects through the broker, telling it the Service’s name, its stream and the subjects it publishes and sends', async () => {
    const { broker, recorded } = aBroker();

    await messaging(contract, broker);

    expect(recorded.connectedWith).toEqual([
      {
        name: 'orders-service',
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
    const evolved = defineContract({
      name: 'orders-service',
      events: [orderCreated(3), orderCreated(1, 'retired'), orderCreated(2, 'deprecated')],
      commands: [chargeCard(1, 'deprecated'), chargeCard(2)],
    });
    const { broker, recorded } = aBroker();

    await messaging(evolved, broker);

    expect(recorded.connectedWith[0]?.subjects).toEqual([
      'orders-service.event.OrderCreated.v2',
      'orders-service.event.OrderCreated.v3',
      'orders-service.command.ChargeCard.v2',
    ]);
  });

  test('messaging() given something that is no Contract rejects and connects nothing', async () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [] });
    const { broker, recorded } = aBroker();

    const opening = messaging(application as never, broker);

    await expect(opening).rejects.toThrow(
      'messaging() takes a Contract declared with defineContract',
    );
    expect(recorded.connectedWith).toEqual([]);
  });

  test('a Subscription whose Event neither the root nor a Dependency lists rejects messaging(), naming it', async () => {
    const unlisted = defineContract({ name: 'orders-service', subscriptions: [notifyOnCreated] });

    const opening = messaging(unlisted, aBroker().broker);

    await expect(opening).rejects.toThrow(
      'notify-on-created subscribes to an Event neither the root nor a Dependency lists',
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
    await second.publisher.publish('OrderCreated', { v1: body });

    expect(recorded.connectedWith).toHaveLength(2);
    expect(recorded.closes).toBe(1);
    expect(recorded.published).toHaveLength(1);
  });

  test('close waits for the Handlers running before it closes the connection', async () => {
    const gate = aGate();
    const notifying = handle(withReader(notifyOnCreated, orderBody), async () => {
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
    await expect(delivered).resolves.toEqual({ kind: 'acked' });
  });

  test('a Handler running during close can still publish', async () => {
    const gate = aGate();
    let publish = (): Promise<void> => Promise.resolve();
    const notifying = handle(withReader(notifyOnCreated, orderBody), async () => {
      await gate.opened;
      await publish();
    });
    const { recorded, deliver, close, publisher } = await consumingWith(notifying);
    publish = () => publisher.publish('OrderCreated', { v1: body });
    const delivered = deliver('orders-service.event.OrderCreated.v1', body);

    const closing = close();
    gate.open();
    await closing;

    await expect(delivered).resolves.toEqual({ kind: 'acked' });
    expect(recorded.published).toHaveLength(1);
  });

  test('a Message delivered while closing is left pending and its Handler never runs', async () => {
    const gate = aGate();
    const runs: unknown[] = [];
    const notifying = handle(withReader(notifyOnCreated, orderBody), async (given) => {
      runs.push(given);
      await gate.opened;
    });
    const { deliver, close } = await consumingWith(notifying);
    const first = deliver('orders-service.event.OrderCreated.v1', body);
    const closing = close();

    const second = await deliver('orders-service.event.OrderCreated.v1', body);
    gate.open();
    await Promise.all([first, closing]);

    expect(second).toEqual({ kind: 'pending', fault: undefined });
    expect(runs).toHaveLength(1);
  });

  test.each([
    ['publish', (opened: Opened) => opened.publisher.publish('OrderCreated', { v1: body })],
    ['send', (opened: Opened) => opened.sender.send('ChargeCard', body)],
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
    ['right after it', async (publish: () => Promise<void>) => publish()],
    [
      'after one more await',
      async (publish: () => Promise<void>) => {
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
      const publish = () => publisher.publish('OrderCreated', { v1: body });
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
    let publish = (): Promise<void> => Promise.resolve();
    const notifying = handle(withReader(notifyOnCreated, orderBody), async () => {
      await publish();
      await publish();
    });
    const { publisher, consume, close } = await messaging(contract, broker);
    publish = () => publisher.publish('OrderCreated', { v1: body });
    await consume({ ...handlers, subscriptions: { 'notify-on-created': notifying } });
    const consumer = consumers.find((candidate) => candidate.element === notifyOnCreated);
    const delivered = consumer?.receive(aDelivery(body));

    const closing = close();
    gate.open();
    await closing;

    await expect(delivered).resolves.toEqual({ kind: 'acked' });
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
    ['publishing', (opened: Opened) => opened.publisher.publish('OrderCreated', { v1: body })],
    ['sending', (opened: Opened) => opened.sender.send('ChargeCard', body)],
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
        publish: async () => undefined,
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
    const publishing = publisher.publish('OrderCreated', { v1: body });

    const closing = close();
    gate.open();
    await closing;

    await expect(publishing).rejects.toBeInstanceOf(PublishError);
    expect(log.filter((call) => call === 'close')).toHaveLength(1);
  });

  test('a publish called right after close with nothing in flight throws messaging is closed and publishes nothing', async () => {
    const { broker, log } = aLoggingBroker({});
    const { publisher, close } = await messaging(contract, broker);
    const closing = close();

    const publishing = publisher.publish('OrderCreated', { v1: body });
    await closing;

    await expect(publishing).rejects.toThrow('messaging is closed');
    expect(log).not.toContain('publish');
  });

  test('consuming while closing throws, and the broker consumes nothing', async () => {
    const gate = aGate();
    const { broker, log } = aLoggingBroker({ publish: gate.opened });
    const { consume, close, publisher } = await messaging(contract, broker);
    const publishing = publisher.publish('OrderCreated', { v1: body });
    const closing = close();

    const consuming = consume(handlers);
    gate.open();
    await Promise.all([publishing, closing]);

    await expect(consuming).rejects.toThrow('messaging is closing');
    expect(log).not.toContain('consume');
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
    await publish('OrderCreated', { v1: body });
    await send('ChargeCard', body);
    await close();

    expect(recorded.published).toHaveLength(2);
    expect(recorded.consumers).toHaveLength(2);
    expect(recorded.closes).toBe(1);
  });
});
