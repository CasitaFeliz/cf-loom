import { afterAll, describe, expect, test, vi } from 'vitest';
import { handlersOf, ordersContract, type Received } from '../../test/orders.ts';
import { messaging } from '../index.ts';
import { inProcess } from './index.ts';

vi.hoisted(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

const limits = { durableConsumerDefaults: { ackWait: '30s', maxDeliver: 3 } } as const;

describe('inProcess() under fake timers installed before it loads', () => {
  test('a sent Command reaches its Handler once timers advance, and a failing one comes again once its wait is advanced', async () => {
    const received: Received[] = [];
    const running = await messaging(ordersContract, inProcess(limits), {
      onServiceFault: () => undefined,
    });
    const failing = () => {
      throw new Error('the Handler failed');
    };
    await running.consume(handlersOf(received, { charge: failing }), {});

    await running.sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    const beforeTimers = received.length;
    await vi.advanceTimersByTimeAsync(1);
    const afterHandOut = received.length;
    await vi.advanceTimersByTimeAsync(29_999);
    const beforeTheWait = received.length;
    await vi.advanceTimersByTimeAsync(1);
    const afterTheWait = received.length;
    await running.close();

    expect([beforeTimers, afterHandOut, beforeTheWait, afterTheWait]).toEqual([0, 1, 1, 2]);
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
  });
});
