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

/** A broker that records what messaging asks of it, built on the public `Broker` type. */
function aBroker(failing: { readonly connect?: Error } = {}) {
  const recorded = {
    connectedWith: [] as BrokerService[],
    published: [] as OutgoingMessage[],
    consumers: [] as BrokerConsumer[],
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

describe('messaging(), connect and close', () => {
  test('creating messaging opens no connection; connect does', async () => {
    const { broker, recorded } = aBroker();
    const { connect } = messaging(contract);

    const connectedBefore = [...recorded.connectedWith];
    await connect(broker);

    expect(connectedBefore).toEqual([]);
    expect(recorded.connectedWith).toHaveLength(1);
  });

  test('messaging() given something that is no Contract throws', () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [] });

    const creating = () => messaging(application as never);

    expect(creating).toThrow('messaging() takes a Contract declared with defineContract');
  });

  test('a Subscription whose Event neither the root nor a Dependency lists throws at messaging(), naming it', () => {
    const unlisted = defineContract({ name: 'orders-service', subscriptions: [notifyOnCreated] });

    const creating = () => messaging(unlisted);

    expect(creating).toThrow(
      'notify-on-created subscribes to an Event neither the root nor a Dependency lists',
    );
  });

  test.each([
    ['publishing', () => messaging(contract).publisher.publish('OrderCreated', { v1: body })],
    ['sending', () => messaging(contract).sender.send('ChargeCard', body)],
    ['consuming', () => messaging(contract).consume(handlers)],
  ])('%s before connect throws', async (_name, call) => {
    const calling = call();

    await expect(calling).rejects.toThrow('messaging is not connected: call connect(broker) first');
  });

  test('connecting while connected throws', async () => {
    const { broker } = aBroker();
    const { connect } = messaging(contract);
    await connect(broker);

    const connecting = connect(broker);

    await expect(connecting).rejects.toThrow('messaging is already connected: close() it first');
  });

  test('connect tells the broker the Service’s name, which names its stream', async () => {
    const { broker, recorded } = aBroker();
    const { connect } = messaging(contract);

    await connect(broker);

    expect(recorded.connectedWith).toEqual([{ name: 'orders-service' }]);
  });

  test('a broker that fails to connect leaves messaging not connected, so connect works again', async () => {
    const error = new Error('no route to the broker');
    const { connect } = messaging(contract);
    await connect(aBroker({ connect: error }).broker).catch(() => undefined);
    const { broker, recorded } = aBroker();

    await connect(broker);

    expect(recorded.connectedWith).toEqual([{ name: 'orders-service' }]);
  });

  test('a broker that fails to connect rejects connect with its error', async () => {
    const error = new Error('no route to the broker');
    const { connect } = messaging(contract);

    const connecting = connect(aBroker({ connect: error }).broker);

    await expect(connecting).rejects.toBe(error);
  });

  test('after close, publishing throws and connect works again', async () => {
    const { broker, recorded } = aBroker();
    const { connect, close, publisher } = messaging(contract);
    await connect(broker);
    await close();

    const publishing = publisher.publish('OrderCreated', { v1: body });
    await connect(broker);

    await expect(publishing).rejects.toThrow('messaging is not connected');
    expect(recorded.closes).toBe(1);
    expect(recorded.connectedWith).toHaveLength(2);
  });

  test('close waits for the Handlers running before it closes the connection', async () => {
    const gate = aGate();
    const { broker, recorded, deliver } = aBroker();
    const notifying = handle(withReader(notifyOnCreated, orderBody), async () => {
      await gate.opened;
    });
    const { connect, consume, close } = messaging(contract);
    await connect(broker);
    await consume({ ...handlers, subscriptions: { 'notify-on-created': notifying } });
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
    const { broker, recorded, deliver } = aBroker();
    const { connect, consume, close, publisher } = messaging(contract);
    const notifying = handle(withReader(notifyOnCreated, orderBody), async () => {
      await gate.opened;
      await publisher.publish('OrderCreated', { v1: body });
    });
    await connect(broker);
    await consume({ ...handlers, subscriptions: { 'notify-on-created': notifying } });
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
    const { broker, deliver } = aBroker();
    const notifying = handle(withReader(notifyOnCreated, orderBody), async (given) => {
      runs.push(given);
      await gate.opened;
    });
    const { connect, consume, close } = messaging(contract);
    await connect(broker);
    await consume({ ...handlers, subscriptions: { 'notify-on-created': notifying } });
    const first = deliver('orders-service.event.OrderCreated.v1', body);
    const closing = close();

    const second = await deliver('orders-service.event.OrderCreated.v1', body);
    gate.open();
    await Promise.all([first, closing]);

    expect(second).toEqual({ kind: 'pending', fault: undefined });
    expect(runs).toHaveLength(1);
  });

  test('close when not connected resolves and does nothing', async () => {
    const { close } = messaging(contract);

    const closing = close();

    await expect(closing).resolves.toBeUndefined();
  });

  test('the functions messaging() returns work destructured', async () => {
    const { broker, recorded } = aBroker();
    const { connect, consume, close, publisher, sender } = messaging(contract);
    const { publish } = publisher;
    const { send } = sender;

    await connect(broker);
    await consume(handlers);
    await publish('OrderCreated', { v1: body });
    await send('ChargeCard', body);
    await close();

    expect(recorded.published).toHaveLength(2);
    expect(recorded.consumers).toHaveLength(2);
    expect(recorded.closes).toBe(1);
  });
});
