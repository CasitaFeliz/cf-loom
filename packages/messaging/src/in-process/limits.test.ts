import { afterEach, describe, expect, test, vi } from 'vitest';
import { aMessagingOver, thirtySeconds } from '../../test/in-process-services.ts';
import { type Behavior, handlersOf, ordersContract, type Received } from '../../test/orders.ts';
import { inProcess } from './index.ts';

const notifyDurable = 'orders-service_notify-on-created';
const chargeDurable = 'orders-service_command_ChargeCard_v1';
const otherDurable = 'billing-service_other';

afterEach(() => {
  vi.useRealTimers();
});

/** `inProcess()` given limits of any shape, as untyped code or a JSON file would. */
function inProcessGiven(limits: unknown) {
  return () => inProcess(limits as never);
}

const duration = 'a duration such as 500ms, 30s, 2m, 1h or 7d, or a list of them';
const count = "a whole number from 1, or 'unlimited'";

describe('inProcess() reading its limits', () => {
  test.each([
    ['a duration that is no duration', { ackWait: 'soon' }, `ackWait 'soon' is not ${duration}`],
    ['a duration of zero', { ackWait: '0s' }, `ackWait '0s' is not ${duration}`],
    ['a number of milliseconds', { ackWait: 30 }, `ackWait 30 is not ${duration}`],
    ['an empty list of waits', { ackWait: [] }, `ackWait [] is not ${duration}`],
    [
      'a list in which one is no duration',
      { ackWait: ['1s', 'x'] },
      `ackWait [ '1s', 'x' ] is not ${duration}`,
    ],
    [
      'a duration whose milliseconds a number cannot hold exactly',
      { ackWait: '200000000000d' },
      `ackWait '200000000000d' is not ${duration}`,
    ],
    ['no deliveries', { maxDeliver: 0 }, `maxDeliver 0 is not ${count}`],
    ['a negative count', { maxDeliver: -1 }, `maxDeliver -1 is not ${count}`],
    ['a fractional count', { maxDeliver: 1.5 }, `maxDeliver 1.5 is not ${count}`],
    ['NaN', { maxDeliver: Number.NaN }, `maxDeliver NaN is not ${count}`],
    ['Infinity', { maxDeliver: Number.POSITIVE_INFINITY }, `maxDeliver Infinity is not ${count}`],
    ['a count written as text', { maxDeliver: '3' }, `maxDeliver '3' is not ${count}`],
    [
      'unlimited in capitals',
      { maxDeliver: 'Unlimited' },
      `maxDeliver 'Unlimited' is not ${count}`,
    ],
    [
      'a setting the Broker does not have',
      { retention: '1d' },
      'retention is a key InProcessBrokerLimits does not define',
    ],
  ])('inProcess() refuses %s, under the defaults and under a name', (_, setting, line) => {
    const underDefaults = inProcessGiven({ durableConsumerDefaults: setting });
    const underName = inProcessGiven({ durableConsumers: { [otherDurable]: setting } });

    expect(underDefaults).toThrow(`limits.durableConsumerDefaults.${line}`);
    expect(underName).toThrow(`limits.durableConsumers.${otherDurable}.${line}`);
  });

  test.each([
    ['streamDefaults', { streamDefaults: { maxAge: '7d' } }],
    ['streams', { streams: { 'orders-service': {} } }],
  ])('inProcess() refuses %s, which a Broker inside the process does not have', (key, limits) => {
    const given = inProcessGiven(limits);

    expect(given).toThrow(`limits.${key} is a key InProcessBrokerLimits does not define`);
  });

  test.each([
    [undefined, 'limits is missing'],
    [null, 'limits is not an object'],
    ['x', 'limits is not an object'],
  ])('inProcess() refuses %j in place of limits', (limits, line) => {
    const given = inProcessGiven(limits);

    expect(given).toThrow(line);
  });

  test('inProcess() refuses every broken place at once, one line each under limits, in the order applyBrokerPlan words them', () => {
    const limits = {
      durableConsumers: { [otherDurable]: { ackWait: '0s' } },
      durableConsumerDefaults: { maxDeliver: 'many' },
      streamDefaults: { maxAge: '7d' },
    };

    const given = inProcessGiven(limits);

    expect(given).toThrow(
      [
        `limits.durableConsumerDefaults.maxDeliver 'many' is not ${count}`,
        `limits.durableConsumers.${otherDurable}.ackWait '0s' is not ${duration}`,
        'limits.streamDefaults is a key InProcessBrokerLimits does not define',
      ].join('\n'),
    );
  });

  test('inProcess() accepts any duration a number holds exactly, and refuses one past it', () => {
    const waiting = (ackWait: string) => ({ durableConsumerDefaults: { ackWait, maxDeliver: 1 } });

    const accepted = inProcessGiven(waiting(`${Number.MAX_SAFE_INTEGER}ms`));
    const refused = inProcessGiven(waiting(`${Number.MAX_SAFE_INTEGER + 1}ms`));

    expect(accepted).not.toThrow();
    expect(refused).toThrow(`ackWait '9007199254740992ms' is not ${duration}`);
  });
});

describe('inProcess() resolving its limits at consume', () => {
  test('consume rejects with a line for a Durable consumer whose limits leave settings unset, and pulls from none, not even the one whose limits are set', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const limits = {
      durableConsumers: { [chargeDurable]: { ackWait: '10s', maxDeliver: 3 } },
    } as const;
    const orders = await aMessagingOver(ordersContract, inProcess(limits));

    const consuming = orders.consume(handlersOf(received), {});

    await expect(consuming).rejects.toThrow(
      `The Durable consumer ${notifyDurable} has no ackWait, maxDeliver in limits.durableConsumers or limits.durableConsumerDefaults`,
    );
    await orders.sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(received).toEqual([]);
  });

  test('consume rejects with one unset line for each Durable consumer whose limits leave a setting unset', async () => {
    const limits = { durableConsumers: { [notifyDurable]: { ackWait: '10s' } } } as const;
    const orders = await aMessagingOver(ordersContract, inProcess(limits));

    const consuming = orders.consume(handlersOf([]), {});

    const lines = await consuming.catch((error: Error) => error.message.split('\n').sort());
    expect(lines).toEqual([
      `The Durable consumer ${chargeDurable} has no ackWait, maxDeliver in limits.durableConsumers or limits.durableConsumerDefaults`,
      `The Durable consumer ${notifyDurable} has no maxDeliver in limits.durableConsumers or limits.durableConsumerDefaults`,
    ]);
  });

  test('consume after inProcess({}) rejects naming every Durable consumer', async () => {
    const orders = await aMessagingOver(ordersContract, inProcess({}));

    const consuming = orders.consume(handlersOf([]), {});

    await expect(consuming).rejects.toThrow(
      [
        `The Durable consumer ${chargeDurable} has no ackWait, maxDeliver in limits.durableConsumers or limits.durableConsumerDefaults`,
        `The Durable consumer ${notifyDurable} has no ackWait, maxDeliver in limits.durableConsumers or limits.durableConsumerDefaults`,
      ].join('\n'),
    );
  });

  test('a name under durableConsumers that no consume hands is accepted', async () => {
    const received: Received[] = [];
    const limits = {
      ...thirtySeconds,
      durableConsumers: { [otherDurable]: { ackWait: '1s' } },
    } as const;
    const orders = await aMessagingOver(ordersContract, inProcess(limits));

    await orders.consume(handlersOf(received), {});

    await orders.sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    await vi.waitFor(() => expect(received).toHaveLength(1));
  });

  test('names every object has are read as entries of their own and never used: a Durable consumer with no entry takes the defaults', async () => {
    vi.useFakeTimers();
    const faults: unknown[] = [];
    const hangs: Behavior = ({ meta }) =>
      new Promise((resolve) => meta.signal.addEventListener('abort', () => resolve(undefined)));
    const entry = { ackWait: '1s', maxDeliver: 1 };
    const durableConsumers = JSON.parse(
      JSON.stringify({ constructor: entry, toString: entry }).replace(
        '{"constructor"',
        '{"__proto__":{"ackWait":"1s","maxDeliver":1},"constructor"',
      ),
    );
    const received: Received[] = [];
    const limits = { ...thirtySeconds, durableConsumers };
    const orders = await aMessagingOver(ordersContract, inProcess(limits), {
      onServiceFault: (consumed) => void faults.push(consumed),
    });
    await orders.consume(handlersOf(received, { charge: hangs }), {});
    await orders.sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });

    await vi.advanceTimersByTimeAsync(29_000);
    const beforeTheDefaultWait = faults.length;
    await vi.advanceTimersByTimeAsync(2_000);

    expect([beforeTheDefaultWait, faults.length]).toEqual([0, 1]);
    expect(received[0]?.meta.lastAttempt).toBe(false);
  });
});
