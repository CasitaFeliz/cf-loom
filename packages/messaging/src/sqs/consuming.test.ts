import { afterAll, beforeAll, beforeEach, describe, expect, onTestFinished, test } from 'vitest';
import { arrangeTopic, dropQueue, wakeEach } from '../../test/aws-arranging.ts';
import { aClosedUrl, anAwsConnecting } from '../../test/aws-clients.ts';
import { queueCountsOf } from '../../test/aws-reading.ts';
import { aMotoServer, type MotoServer } from '../../test/moto-server.ts';
import {
  anOrders,
  arrangeOrders,
  handlersOf,
  ordersContract,
  type Received,
} from '../../test/orders.ts';
import { until } from '../../test/until.ts';
import { messaging } from '../index.ts';
import { type SqsConnecting, sqs } from './index.ts';

let moto: MotoServer;

beforeAll(async () => {
  moto = await aMotoServer();
});

afterAll(async () => {
  await moto.stop();
});

beforeEach(async () => {
  await moto.reset();
});

/** Closes a messaging when the test ends, waking its open polls so the closing does not wait them out. */
function closedWhenDone(
  started: { readonly close: () => Promise<void> },
  connecting: SqsConnecting,
): void {
  const orders = anOrders('staging');
  onTestFinished(async () => {
    const closing = started.close();
    for (const queue of [orders.notifyQueue, orders.chargeQueue]) {
      await wakeEach(connecting.sqs, [queue]).catch(() => undefined);
    }
    await closing.catch(() => undefined);
  });
}

/** An Orders messaging over sqs() on the test's moto, closed when the test ends, with the names it works with. */
async function aMessaging() {
  const connecting = anAwsConnecting(moto.url);
  await arrangeOrders(connecting, { prefix: 'staging' });
  const started = await messaging(ordersContract, sqs({ ...connecting, prefix: 'staging' }));
  closedWhenDone(started, connecting);
  return { ...started, connecting, orders: anOrders('staging') };
}

describe('consuming over sqs()', () => {
  test('consume finds the prefixed queue of each Subscription and Command Version, and a Message published before or after reaches its Handler', async () => {
    const { publisher, sender, consume } = await aMessaging();
    const received: Received[] = [];
    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    await sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-2' });

    await consume(handlersOf(received), {});
    await publisher.publish('OrderCreated', { v1: { orderId: 'o-3' } }, { factId: 'f-3' });
    await sender.send('ChargeCard', { orderId: 'o-4' }, { factId: 'f-4' });

    await until(() => expect(received).toHaveLength(4));
    const handled = received.map(({ handler, body }) => `${handler} ${JSON.stringify(body)}`);
    expect(handled.sort()).toEqual([
      'ChargeCard@1 {"orderId":"o-2"}',
      'ChargeCard@1 {"orderId":"o-4"}',
      'notifyOnCreated {"orderId":"o-1"}',
      'notifyOnCreated {"orderId":"o-3"}',
    ]);
  });

  test('consume rejects naming each Durable consumer whose queue does not exist', async () => {
    const connecting = anAwsConnecting(moto.url);
    await arrangeTopic(connecting.sns, 'staging_orders-service');
    const { consume } = await messaging(ordersContract, sqs({ ...connecting, prefix: 'staging' }));
    const orders = anOrders('staging');

    const consuming = consume(handlersOf([]), {});

    await expect(consuming).rejects.toMatchObject({
      message: expect.stringContaining(
        `The Durable consumer ${orders.notifyDurable} has no queue ${orders.notifyQueue}: apply the Service's Broker plan`,
      ),
    });
    await expect(consuming).rejects.toMatchObject({
      message: expect.stringContaining(
        `The Durable consumer ${orders.chargeDurable} has no queue ${orders.chargeQueue}: apply the Service's Broker plan`,
      ),
    });
  });

  test('consume with one queue missing receives from none: the Message in the other stays in its queue', async () => {
    const { sender, consume, connecting, orders } = await aMessaging();
    await dropQueue(connecting.sqs, orders.notifyQueue);
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    const received: Received[] = [];

    const consuming = consume(handlersOf(received), {});

    await expect(consuming).rejects.toThrow(
      `The Durable consumer ${orders.notifyDurable} has no queue`,
    );
    await expect(queueCountsOf(connecting.sqs, orders.chargeQueue)).resolves.toEqual({
      visible: 1,
      inFlight: 0,
    });
    expect(received).toEqual([]);
  });

  test('any other error of the queue check rejects consume unchanged, and nothing is received', async () => {
    const working = anAwsConnecting(moto.url);
    await arrangeOrders(working, { prefix: 'staging' });
    const broken = anAwsConnecting(moto.url, { sqsUrl: await aClosedUrl() });
    const { sender, consume } = await messaging(
      ordersContract,
      sqs({ ...broken, prefix: 'staging' }),
    );
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    const received: Received[] = [];

    const consuming = consume(handlersOf(received), {});

    await expect(consuming).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    await expect(queueCountsOf(working.sqs, anOrders('staging').chargeQueue)).resolves.toEqual({
      visible: 1,
      inFlight: 0,
    });
    expect(received).toEqual([]);
  });

  test('consume called again once the queues exist starts consuming', async () => {
    const connecting = anAwsConnecting(moto.url);
    await arrangeTopic(connecting.sns, 'staging_orders-service');
    const { sender, consume } = await messaging(
      ordersContract,
      sqs({ ...connecting, prefix: 'staging' }),
    );
    onTestFinished(async () => {
      const orders = anOrders('staging');
      await wakeEach(connecting.sqs, [orders.notifyQueue, orders.chargeQueue]).catch(
        () => undefined,
      );
    });
    const received: Received[] = [];
    await expect(consume(handlersOf(received), {})).rejects.toThrow('has no queue');
    await arrangeOrders(connecting, { prefix: 'staging' });
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });

    await consume(handlersOf(received), {});

    await until(() => expect(received).toHaveLength(1));
  });
});
