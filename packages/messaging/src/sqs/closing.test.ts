import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { wakeEach } from '../../test/aws-arranging.ts';
import { countCommands } from '../../test/aws-clients.ts';
import { queueCountsOf } from '../../test/aws-reading.ts';
import { aMotoServer, type MotoServer } from '../../test/moto-server.ts';
import { handlersOf, type Received } from '../../test/orders.ts';
import {
  aGate,
  anOrdersMessaging,
  orderMessagingOver,
  type Settings,
} from '../../test/orders-messaging.ts';
import { until } from '../../test/until.ts';
import { CloseAbortedError } from '../index.ts';

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

function aMessaging(settings: Settings = {}) {
  return anOrdersMessaging(moto.url, settings);
}

describe('close over sqs()', () => {
  test('close lets the open poll finish and hands back the Message it returns, so the next process receives it at once with delivery count 2', async () => {
    const first = await aMessaging();
    const producer = await orderMessagingOver(first.connecting);
    await first.consume(handlersOf([]), {});
    const closing = first.close();

    await producer.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    await producer.sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-2' });
    await closing;

    await expect(queueCountsOf(first.connecting.sqs, first.orders.notifyQueue)).resolves.toEqual({
      visible: 1,
      inFlight: 0,
    });
    const next = await orderMessagingOver(first.connecting);
    const received: Received[] = [];
    await next.consume(handlersOf(received), {});
    await until(() => expect(received).toHaveLength(2));
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([2, 2]);
  });

  test('close with an empty open poll resolves once the poll ends, and receives nothing after: a Message published then stays in the queue with no receive', async () => {
    const { consume, close, connecting, orders } = await aMessaging();
    const receives = countCommands(connecting.sqs, 'ReceiveMessageCommand');
    await consume(handlersOf([]), {});

    await close();
    const receivedBefore = receives.sent();
    const producer = await orderMessagingOver(connecting);
    await producer.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    expect(receives.sent()).toBe(receivedBefore);
    await expect(queueCountsOf(connecting.sqs, orders.notifyQueue)).resolves.toEqual({
      visible: 1,
      inFlight: 0,
    });
  });

  test('close waits for a running Handler and deletes its Message before it resolves', async () => {
    const { publisher, consume, close, connecting, orders } = await aMessaging();
    const received: Received[] = [];
    const gate = aGate();
    await consume(handlersOf(received, { notify: () => gate.opened }), {});
    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    await until(() => expect(received).toHaveLength(1));

    let closed = false;
    const closing = close().then(() => {
      closed = true;
    });
    await wakeEach(connecting.sqs, [orders.chargeQueue]);
    await queueCountsOf(connecting.sqs, orders.notifyQueue);
    expect(closed).toBe(false);
    gate.open();
    await closing;

    await expect(queueCountsOf(connecting.sqs, orders.notifyQueue)).resolves.toEqual({
      visible: 0,
      inFlight: 0,
    });
  });

  test('close({ signal }) with a Handler that never settles hands its Message back, so the next process receives it at once with delivery count 2', async () => {
    const first = await aMessaging();
    const received: Received[] = [];
    const gate = aGate();
    await first.consume(handlersOf(received, { notify: () => gate.opened }), {});
    await first.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    await until(() => expect(received).toHaveLength(1));

    const aborting = new AbortController();
    const closing = first.close({ signal: aborting.signal });
    await wakeEach(first.connecting.sqs, [first.orders.chargeQueue]);
    aborting.abort();

    await expect(closing).rejects.toBeInstanceOf(CloseAbortedError);
    await expect(queueCountsOf(first.connecting.sqs, first.orders.notifyQueue)).resolves.toEqual({
      visible: 1,
      inFlight: 0,
    });
    const next = await orderMessagingOver(first.connecting);
    const again: Received[] = [];
    await next.consume(handlersOf(again), {});
    await until(() => expect(again.map(({ meta }) => meta.deliveryCount)).toEqual([2]));
  });
});
