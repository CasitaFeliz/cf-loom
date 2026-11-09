import { fileURLToPath } from 'node:url';
import { joinedOf } from '@cf-loom/contract/internal';
import { handle } from '@cf-loom/handlers';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { printedBy } from '../../../contract/test/printed.ts';
import { storeIn, wakeEach } from '../../test/aws-arranging.ts';
import { countCommands, failingCommand, holdingCommand } from '../../test/aws-clients.ts';
import { queueCountsOf, topicNamesOf } from '../../test/aws-reading.ts';
import { aGate } from '../../test/gate.ts';
import { aMotoServer, type MotoServer } from '../../test/moto-server.ts';
import { handlersOf, ordersReaders, type Received } from '../../test/orders.ts';
import {
  anOrdersMessaging,
  limitsWith,
  orderMessagingOver,
  type Settings,
} from '../../test/orders-messaging.ts';
import { startProcess } from '../../test/test-process.ts';
import { until } from '../../test/until.ts';
import { type BrokerTrouble, CloseAbortedError } from '../index.ts';

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

const nodeExecutable = globalThis.process.execPath;

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

  test('close while a later Delivery’s visibility change is still running hands its Message back instead of delivering it', async () => {
    const first = await aMessaging({
      limits: limitsWith({ ackWait: ['1s', '2s'], maxDeliver: 5 }),
    });
    const holding = holdingCommand(first.connecting.sqs, 'ChangeMessageVisibilityCommand');
    const received: Received[] = [];
    const throwingOnce = ({ meta }: Received) => {
      if (meta.deliveryCount === 1) {
        throw new Error('the database is down');
      }
      return undefined;
    };
    await first.consume(handlersOf(received, { notify: throwingOnce }), {});
    await first.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    await holding.reached;

    const closing = first.close();
    await wakeEach(first.connecting.sqs, [first.orders.chargeQueue]);
    holding.open();
    await closing;

    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1]);
    await expect(queueCountsOf(first.connecting.sqs, first.orders.notifyQueue)).resolves.toEqual({
      visible: 1,
      inFlight: 0,
    });
  });

  test('an unreadable Message the open poll returns once closing started is handed back unread, with no console line', async () => {
    const printed = printedBy('error');
    const first = await aMessaging();
    await first.consume(handlersOf([]), {});
    const closing = first.close();

    await storeIn(first.connecting.sqs, first.orders.notifyQueue, 'not cf-loom’s');
    await wakeEach(first.connecting.sqs, [first.orders.chargeQueue]);
    await closing;

    await expect(queueCountsOf(first.connecting.sqs, first.orders.notifyQueue)).resolves.toEqual({
      visible: 1,
      inFlight: 0,
    });
    expect(printed).toEqual([]);
  });

  test('close while consume is still checking the queues means no receive at all', async () => {
    const { consume, close, connecting } = await aMessaging();
    const receives = countCommands(connecting.sqs, 'ReceiveMessageCommand');
    const holding = holdingCommand(connecting.sqs, 'GetQueueAttributesCommand');

    const consuming = consume(handlersOf([]), {});
    const closing = close();
    holding.open();
    await consuming;
    await closing;

    expect(receives.sent()).toBe(0);
  });

  test('close while pulls fail leaves no retry pause running and reports nothing more', async () => {
    const troubles: BrokerTrouble[] = [];
    const { consume, close, connecting } = await aMessaging({
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });
    failingCommand(connecting.sqs, {
      command: 'ReceiveMessageCommand',
      error: new Error('SQS is down'),
    });
    const timersBefore = activeTimers();
    await consume(handlersOf([]), {});
    await until(() => expect(troubles).toHaveLength(2));

    await close();

    expect(activeTimers()).toBeLessThanOrEqual(timersBefore);
    expect(troubles.map(({ kind }) => kind)).toEqual(['pull-failed', 'pull-failed']);
  });

  test('close leaves the organization’s SNS and SQS clients usable', async () => {
    const { consume, close, connecting, orders } = await aMessaging();
    await consume(handlersOf([]), {});
    await wakeEach(connecting.sqs, [orders.notifyQueue, orders.chargeQueue]);
    await close();

    const topics = await topicNamesOf(connecting.sns);
    const counts = await queueCountsOf(connecting.sqs, orders.notifyQueue);

    expect(topics).toEqual(['staging_orders-service']);
    expect(counts.visible + counts.inFlight).toBe(1);
  });

  test('a hand-back SQS refuses at close makes close reject naming the Durable consumer, with the client’s error as cause', async () => {
    printedBy('warn');
    const first = await aMessaging();
    const producer = await orderMessagingOver(first.connecting);
    const refusal = new Error('SQS refused the hand-back');
    failingCommand(first.connecting.sqs, {
      command: 'ChangeMessageVisibilityCommand',
      error: refusal,
    });
    const handlers = {
      ...handlersOf([]),
      commands: { chargeCardV1: handle.stub(ordersReaders.commands.chargeCardV1) },
    };
    await first.consume(handlers, {});
    const closing = first.close();
    const rejection = closing.then(
      () => undefined,
      (error: unknown) => error,
    );

    await producer.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    const error = await rejection;
    expect(error).toMatchObject({
      message: `SQS refused to settle Messages of the Durable consumers ${first.orders.notifyDurable}`,
    });
    expect((error as Error).cause).toBe(refusal);
  });

  test('a DeleteMessage SQS refuses after closing aborted makes close reject the same way, naming every Durable consumer once', async () => {
    const { publisher, sender, consume, close, connecting, orders } = await aMessaging();
    const refusal = new Error('SQS refused the delete');
    failingCommand(connecting.sqs, { command: 'DeleteMessageCommand', error: refusal });
    const received: Received[] = [];
    const gate = aGate();
    const held = () => gate.opened;
    await consume(handlersOf(received, { notify: held, charge: held }), {});
    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    await sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-2' });
    await until(() => expect(received).toHaveLength(2));
    const closing = close();
    const rejection = closing.then(
      () => undefined,
      (error: unknown) => error,
    );

    gate.open();

    const error = await rejection;
    const message = (error as Error).message;
    expect(message.startsWith('SQS refused to settle Messages of the Durable consumers ')).toBe(
      true,
    );
    const named = message.slice(message.indexOf('consumers ') + 'consumers '.length);
    const durables = [orders.chargeDurable, orders.notifyDurable];
    expect([joinedOf(durables, 'and'), joinedOf([...durables].reverse(), 'and')]).toContain(named);
    expect((error as Error).cause).toBe(refusal);
  });

  test('a process whose messaging over sqs() closed exits on its own: nothing of the adapter’s is left running', async () => {
    const { connecting, orders } = await aMessaging();
    const producer = await orderMessagingOver(connecting);
    await producer.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    const fixture = fileURLToPath(new URL('../../test/sqs-closing-fixture.ts', import.meta.url));
    const process = startProcess(nodeExecutable, [fixture, moto.url, 'staging']);

    await until(() => expect(process.stdout()).toContain('closing'));
    await wakeEach(connecting.sqs, [orders.notifyQueue, orders.chargeQueue]);

    const exit = await process.exited;
    expect(exit, process.stderr()).toEqual({ status: 0, signal: null });
  });
});

/** How many timers this process has running, to say none outlives what a test closed. */
function activeTimers(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
}
