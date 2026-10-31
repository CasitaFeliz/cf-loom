import { afterEach, describe, expect, test, vi } from 'vitest';
import { aGate } from '../../test/gate.ts';
import { aMessagingOver, thirtySeconds } from '../../test/in-process-services.ts';
import { type Behavior, handlersOf, ordersContract, type Received } from '../../test/orders.ts';
import type { Delivery, DurableConsumer, OutgoingMessage } from '../index.ts';
import { CloseAbortedError } from '../index.ts';
import { inProcess } from './index.ts';

afterEach(() => {
  vi.useRealTimers();
});

const chargeSubject = 'orders-service.command.ChargeCard.v1';

/** A Message of the Command, as a Broker takes it. */
const aCharge: OutgoingMessage = {
  subject: chargeSubject,
  messageId: 'command.ChargeCard.v1:f-1',
  factId: 'f-1',
  headers: {},
  body: new TextEncoder().encode('{"orderId":"o-1"}'),
};

const order = (orderId: string) => ({ orderId });

/** A Handler that fails once the gate opens. */
function failsOnceOpened(opened: Promise<undefined>): Behavior {
  return async () => {
    await opened;
    throw new Error('the Handler failed');
  };
}

describe('inProcess() consuming and closing', () => {
  test('consume with closing already aborted registers nothing, and a Message sent then reaches no Handler', async () => {
    vi.useFakeTimers();
    const received: Delivery[] = [];
    const durableConsumer: DurableConsumer = {
      durable: 'orders-service_command_ChargeCard_v1',
      stream: 'orders-service',
      subject: chargeSubject,
      receive: async (delivery) => {
        received.push(delivery);
        return 'acked';
      },
    };
    const connection = await inProcess(thirtySeconds).connect({
      stream: 'orders-service',
      subjects: [chargeSubject],
    });

    await connection.consume([durableConsumer], {
      closing: AbortSignal.abort(),
      troubled: () => undefined,
    });
    await connection.publish(aCharge);
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(received).toEqual([]);
  });

  test('close() waits for a running Handler, and hands nothing more to that connection', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds));
    const gate = aGate();
    await orders.consume(handlersOf(received, { charge: () => gate.opened }), {});
    await orders.sender.send('ChargeCard', order('o-1'), { factId: 'f-1' });
    await vi.advanceTimersByTimeAsync(1_000);
    await orders.sender.send('ChargeCard', order('o-2'), { factId: 'f-2' });

    const closing = orders.close();
    await vi.advanceTimersByTimeAsync(1_000);
    const closedWhileRunning = await Promise.race([
      closing.then(() => true),
      Promise.resolve(false),
    ]);
    gate.open();
    await closing;
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(closedWhileRunning).toBe(false);
    expect(received.map(({ body }) => body)).toEqual([order('o-1')]);
  });

  test('a Message lined up when the last connection consuming its Durable consumer closes is dropped: a later consume through the same inProcess() does not receive it', async () => {
    vi.useFakeTimers();
    const broker = inProcess(thirtySeconds);
    const first = await aMessagingOver(ordersContract, broker);
    const gate = aGate();
    await first.consume(handlersOf([], { charge: () => gate.opened }), {});
    await first.sender.send('ChargeCard', order('o-1'), { factId: 'f-1' });
    await vi.advanceTimersByTimeAsync(1_000);
    await first.sender.send('ChargeCard', order('o-2'), { factId: 'f-2' });
    const closing = first.close();
    gate.open();
    await closing;

    const later = await aMessagingOver(ordersContract, broker);
    const receivedLater: Received[] = [];
    await later.consume(handlersOf(receivedLater), {});
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(receivedLater).toEqual([]);
  });

  test('a Message lined up when the only connection consuming its Durable consumer starts closing, with no Delivery in flight, is dropped', async () => {
    vi.useFakeTimers();
    const broker = inProcess(thirtySeconds);
    const first = await aMessagingOver(ordersContract, broker);
    await first.consume(handlersOf([]), {});
    await first.sender.send('ChargeCard', order('o-1'), { factId: 'f-1' });
    await first.close();

    const later = await aMessagingOver(ordersContract, broker);
    const receivedLater: Received[] = [];
    await later.consume(handlersOf(receivedLater), {});
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(receivedLater).toEqual([]);
  });

  test('with another connection still consuming, a Message lined up when the first closes reaches the other', async () => {
    vi.useFakeTimers();
    const broker = inProcess(thirtySeconds);
    const first = await aMessagingOver(ordersContract, broker);
    const second = await aMessagingOver(ordersContract, broker);
    const receivedBySecond: Received[] = [];
    await first.consume(handlersOf([]), {});
    await second.consume(handlersOf(receivedBySecond), {});
    await first.sender.send('ChargeCard', order('o-1'), { factId: 'f-1' });

    await first.close();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(receivedBySecond.map(({ body }) => body)).toEqual([order('o-1')]);
  });

  test('a Handler still running when the last connection closes leaves no timer behind: its failure, settled after closing aborted, schedules nothing, and the line is dropped', async () => {
    vi.useFakeTimers();
    const broker = inProcess(thirtySeconds);
    const first = await aMessagingOver(ordersContract, broker, { onServiceFault: () => undefined });
    const gate = aGate();
    await first.consume(handlersOf([], { charge: failsOnceOpened(gate.opened) }), {});
    await first.sender.send('ChargeCard', order('o-1'), { factId: 'f-1' });
    await vi.advanceTimersByTimeAsync(1_000);
    const closing = first.close();
    gate.open();
    await closing;
    const timersLeft = vi.getTimerCount();

    const later = await aMessagingOver(ordersContract, broker);
    const receivedLater: Received[] = [];
    await later.consume(handlersOf(receivedLater), {});
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect([timersLeft, receivedLater.length]).toEqual([0, 0]);
  });

  test('a connection that consumes while the other is still closing receives the retry of the Handler that failed during that close', async () => {
    vi.useFakeTimers();
    const broker = inProcess(thirtySeconds);
    const first = await aMessagingOver(ordersContract, broker, { onServiceFault: () => undefined });
    const gate = aGate();
    await first.consume(handlersOf([], { charge: failsOnceOpened(gate.opened) }), {});
    await first.sender.send('ChargeCard', order('o-1'), { factId: 'f-1' });
    await vi.advanceTimersByTimeAsync(1_000);
    const closing = first.close();
    const second = await aMessagingOver(ordersContract, broker);
    const receivedBySecond: Received[] = [];
    await second.consume(handlersOf(receivedBySecond), {});
    gate.open();
    await closing;

    await vi.advanceTimersByTimeAsync(31_000);

    expect(receivedBySecond.map(({ body, meta }) => [body, meta.deliveryCount])).toEqual([
      [order('o-1'), 2],
    ]);
  });

  test('a Delivery that close({ signal }) hands back reaches the other connection consuming it at once, as the next delivery', async () => {
    vi.useFakeTimers();
    const broker = inProcess(thirtySeconds);
    const first = await aMessagingOver(ordersContract, broker);
    const second = await aMessagingOver(ordersContract, broker);
    const gate = aGate();
    const receivedBySecond: Received[] = [];
    await first.consume(handlersOf([], { charge: () => gate.opened }), {});
    await first.sender.send('ChargeCard', order('o-1'), { factId: 'f-1' });
    await vi.advanceTimersByTimeAsync(1_000);
    await second.consume(handlersOf(receivedBySecond), {});

    const closing = first.close({ signal: AbortSignal.abort() });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(closing).rejects.toBeInstanceOf(CloseAbortedError);
    expect(receivedBySecond.map(({ meta }) => [meta.deliveryCount, meta.lastAttempt])).toEqual([
      [2, false],
    ]);
  });

  test('a Message handed back on its last attempt never comes again', async () => {
    vi.useFakeTimers();
    const broker = inProcess({ durableConsumerDefaults: { ackWait: '30s', maxDeliver: 1 } });
    const first = await aMessagingOver(ordersContract, broker);
    const second = await aMessagingOver(ordersContract, broker);
    const gate = aGate();
    const receivedBySecond: Received[] = [];
    await first.consume(handlersOf([], { charge: () => gate.opened }), {});
    await second.consume(handlersOf(receivedBySecond), {});
    await first.sender.send('ChargeCard', order('o-1'), { factId: 'f-1' });
    await vi.advanceTimersByTimeAsync(1_000);

    const closing = first.close({ signal: AbortSignal.abort() });
    await closing.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(receivedBySecond).toEqual([]);
  });
});
