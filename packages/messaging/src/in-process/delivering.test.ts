import { createServer } from 'node:http';
import { fault } from '@cf-loom/handlers';
import { afterEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { printedBy } from '../../../contract/test/printed.ts';
import { aGate } from '../../test/gate.ts';
import {
  aMessagingOver,
  auditingContract,
  auditingHandlersOf,
  billingContract,
  billingHandlersOf,
  thirtySeconds,
} from '../../test/in-process-services.ts';
import { type Behavior, handlersOf, ordersContract, type Received } from '../../test/orders.ts';
import { until } from '../../test/until.ts';
import {
  type ConsumedFault,
  DeadlineError,
  type Delivery,
  type DurableConsumer,
  type OutgoingMessage,
} from '../index.ts';
import { inProcess } from './index.ts';

const chargeDurable = 'orders-service_command_ChargeCard_v1';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const failing: Behavior = () => {
  throw new Error('the Handler failed');
};

/** A Handler that runs until its wait passes, which aborts its signal. */
const hangs: Behavior = ({ meta }) =>
  new Promise((resolve) => meta.signal.addEventListener('abort', () => resolve(undefined)));

/** The faults a Service receives, through its `onServiceFault`. */
function faultsOf() {
  const faults: ConsumedFault[] = [];
  const options = { onServiceFault: (consumed: ConsumedFault) => void faults.push(consumed) };
  return { faults, options };
}

/** The name and the wait of each Handler that ran past it, from the `DeadlineError` of its fault. */
function deadlinesOf(faults: readonly ConsumedFault[]) {
  const deadlines: { readonly name: string; readonly waitMs: number }[] = [];
  for (const consumed of faults) {
    if (consumed.kind === 'thrown' && consumed.cause instanceof DeadlineError) {
      deadlines.push({ name: consumed.name, waitMs: consumed.cause.waitMs });
    }
  }
  return deadlines;
}

const order = { orderId: 'o-1' };

describe('inProcess() delivering to the Service’s own Handlers', () => {
  test('a Command the Service sends reaches its Message Handler with nobody waiting, as delivery 1, not the last', async () => {
    const received: Received[] = [];
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds));
    await orders.consume(handlersOf(received), {});

    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    await until(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      handler: 'ChargeCard@1',
      body: order,
      meta: { factId: 'f-1', deliveryCount: 1, lastAttempt: false },
    });
  });

  test('an Event the Service publishes reaches each of its own Subscriptions to it', async () => {
    const received: Received[] = [];
    const audited = await aMessagingOver(auditingContract, inProcess(thirtySeconds));
    await audited.consume(auditingHandlersOf(received), {});

    await audited.publisher.publish('OrderCreated', { v1: order }, { factId: 'f-1' });

    await until(() => expect(received).toHaveLength(2));
    const handlers = received.map(({ handler }) => handler);
    expect(handlers.sort()).toEqual(['auditOnCreated', 'notifyOnCreated']);
  });

  test('send resolves before its Handler has started', async () => {
    const received: Received[] = [];
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds));
    await orders.consume(handlersOf(received), {});

    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    const whenSendResolved = received.length;
    await until(() => expect(received).toHaveLength(1));
    expect(whenSendResolved).toBe(0);
  });

  test('Messages sent in a row reach the Handler in the order sent', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds));
    await orders.consume(handlersOf(received), {});

    for (const orderId of ['o-1', 'o-2', 'o-3']) {
      await orders.sender.send('ChargeCard', { orderId }, { factId: orderId });
    }
    await vi.advanceTimersByTimeAsync(1_000);

    expect(received.map(({ body }) => body)).toEqual([
      { orderId: 'o-1' },
      { orderId: 'o-2' },
      { orderId: 'o-3' },
    ]);
  });

  test('a pending Message comes back after a Message lined up before its wait passed', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const limits = { durableConsumerDefaults: { ackWait: '10s', maxDeliver: 3 } } as const;
    const orders = await aMessagingOver(ordersContract, inProcess(limits), {
      onServiceFault: () => undefined,
    });
    const gate = aGate();
    const behavior: Behavior = ({ body, meta }) => {
      const { orderId } = body as { orderId: string };
      if (orderId === 'o-1' && meta.deliveryCount === 1) {
        throw new Error('the Handler failed');
      }
      return orderId === 'o-2' ? gate.opened : undefined;
    };
    await orders.consume(handlersOf(received, { charge: behavior }), {});
    await orders.sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    await vi.advanceTimersByTimeAsync(8_000);
    await orders.sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-2' });
    await vi.advanceTimersByTimeAsync(1_000);
    await orders.sender.send('ChargeCard', { orderId: 'o-3' }, { factId: 'f-3' });
    await vi.advanceTimersByTimeAsync(2_000);

    gate.open();
    await vi.advanceTimersByTimeAsync(1_000);

    const starts = received.map(
      ({ body, meta }) => `${(body as { orderId: string }).orderId} ${meta.deliveryCount}`,
    );
    expect(starts).toEqual(['o-1 1', 'o-2 1', 'o-3 1', 'o-1 2']);
  });

  test('a Handler that throws gets the Message again once its ack wait passed, as delivery 2', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const { options } = faultsOf();
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds), options);
    await orders.consume(handlersOf(received, { charge: failing }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    await vi.advanceTimersByTimeAsync(29_000);
    const beforeTheWait = received.map(({ meta }) => meta.deliveryCount);
    await vi.advanceTimersByTimeAsync(2_000);
    const afterTheWait = received.map(({ meta }) => meta.deliveryCount);

    expect([beforeTheWait, afterTheWait]).toEqual([[1], [1, 2]]);
  });

  test('with a list of waits, delivery 1 waits the first, delivery 2 the second and every later one the last, and each Handler’s wait is its delivery’s entry', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const { faults, options } = faultsOf();
    const limits = { durableConsumerDefaults: { ackWait: ['10s', '20s'], maxDeliver: 5 } } as const;
    const orders = await aMessagingOver(ordersContract, inProcess(limits), options);
    await orders.consume(handlersOf(received, { charge: hangs }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    const deliveriesAt: number[] = [];
    for (const elapsedMs of [9_000, 2_000, 18_000, 2_000, 18_000, 2_000]) {
      await vi.advanceTimersByTimeAsync(elapsedMs);
      deliveriesAt.push(received.length);
    }

    expect(deliveriesAt).toEqual([1, 2, 2, 3, 3, 4]);
    expect(deadlinesOf(faults).map(({ waitMs }) => waitMs)).toEqual([10_000, 20_000, 20_000]);
  });

  test('a Durable consumer’s own settings under its name override the defaults: its waits differ from another’s', async () => {
    vi.useFakeTimers();
    const { faults, options } = faultsOf();
    const limits = {
      durableConsumerDefaults: { ackWait: '10s', maxDeliver: 1 },
      durableConsumers: { [chargeDurable]: { ackWait: '20s' } },
    } as const;
    const orders = await aMessagingOver(ordersContract, inProcess(limits), options);
    await orders.consume(handlersOf([], { charge: hangs, notify: hangs }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });
    await orders.publisher.publish('OrderCreated', { v1: order }, { factId: 'f-2' });

    await vi.advanceTimersByTimeAsync(21_000);

    const waits = deadlinesOf(faults).map(({ name, waitMs }) => `${name} ${waitMs}`);
    expect(waits.sort()).toEqual(['ChargeCard@1 20000', 'notifyOnCreated 10000']);
  });

  test('the delivery that reaches maxDeliver is the last attempt, and failing it the Message never comes again', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds), {
      onServiceFault: () => undefined,
    });
    await orders.consume(handlersOf(received, { charge: failing }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    await vi.advanceTimersByTimeAsync(3_600_000);

    const attempts = received.map(({ meta }) => [meta.deliveryCount, meta.lastAttempt]);
    expect(attempts).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
  });

  test('without onServiceFault, the console line of the last attempt reads attempt <n>, the last', async () => {
    vi.useFakeTimers();
    const printed = printedBy('error');
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds));
    const retryable: Behavior = () =>
      fault({ committed: 'no', retryable: true, message: 'card 503' });
    await orders.consume(handlersOf([], { charge: retryable }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(printed).toEqual([
      'ChargeCard@1 orders-service.command.ChargeCard.v1 command.ChargeCard.v1:f-1 f-1 attempt 1: card 503',
      'ChargeCard@1 orders-service.command.ChargeCard.v1 command.ChargeCard.v1:f-1 f-1 attempt 2: card 503',
      'ChargeCard@1 orders-service.command.ChargeCard.v1 command.ChargeCard.v1:f-1 f-1 attempt 3, the last: card 503',
    ]);
  });

  test('with maxDeliver unlimited no delivery is the last attempt, and the Message comes again until the Handler acknowledges it', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const limits = { durableConsumerDefaults: { ackWait: '1s', maxDeliver: 'unlimited' } } as const;
    const orders = await aMessagingOver(ordersContract, inProcess(limits), {
      onServiceFault: () => undefined,
    });
    const failsFiveTimes: Behavior = ({ meta }) => {
      if (meta.deliveryCount <= 5) {
        throw new Error('the Handler failed');
      }
      return undefined;
    };
    await orders.consume(handlersOf(received, { charge: failsFiveTimes }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(received.map(({ meta }) => [meta.deliveryCount, meta.lastAttempt])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, false],
      [5, false],
      [6, false],
    ]);
  });

  test('a Fault that is not retryable ends the Message: it never comes again', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const ending: Behavior = () =>
      fault({ committed: 'no', retryable: false, message: 'declined' });
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds), {
      onServiceFault: () => undefined,
    });
    await orders.consume(handlersOf(received, { charge: ending }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(received).toHaveLength(1);
  });

  test('a Handler that runs past its wait gets a DeadlineError, and the Message comes again after the wait', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const { faults, options } = faultsOf();
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds), options);
    await orders.consume(handlersOf(received, { charge: hangs }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    await vi.advanceTimersByTimeAsync(29_000);
    const beforeTheWait = received.length;
    await vi.advanceTimersByTimeAsync(2_000);

    expect([beforeTheWait, received.length]).toEqual([1, 2]);
    expect(deadlinesOf(faults)).toEqual([{ name: 'ChargeCard@1', waitMs: 30_000 }]);
  });

  test('the last attempt arms no timer: once it settles, nothing is left waiting', async () => {
    vi.useFakeTimers();
    const limits = { durableConsumerDefaults: { ackWait: '30s', maxDeliver: 1 } } as const;
    const orders = await aMessagingOver(ordersContract, inProcess(limits), {
      onServiceFault: () => undefined,
    });
    await orders.consume(handlersOf([], { charge: failing }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(vi.getTimerCount()).toBe(0);
  });

  const acknowledging: Behavior = () => undefined;
  const ending: Behavior = () => fault({ committed: 'no', retryable: false, message: 'declined' });

  test.each([
    ['acknowledges it', acknowledging],
    ['ends it', ending],
  ])('a Handler that %s leaves no timer waiting for a redelivery', async (_, answer) => {
    vi.useFakeTimers();
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds), {
      onServiceFault: () => undefined,
    });
    await orders.consume(handlersOf([], { charge: answer }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(vi.getTimerCount()).toBe(0);
  });

  test('a 30-day wait is timed in steps: the Message is not delivered again before it', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const limits = { durableConsumerDefaults: { ackWait: '30d', maxDeliver: 3 } } as const;
    const orders = await aMessagingOver(ordersContract, inProcess(limits), {
      onServiceFault: () => undefined,
    });
    await orders.consume(handlersOf(received, { charge: failing }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });

    await vi.advanceTimersByTimeAsync(29 * 86_400_000);
    const beforeTheWait = received.length;
    await vi.advanceTimersByTimeAsync(2 * 86_400_000);

    expect([beforeTheWait, received.length]).toEqual([1, 2]);
  });

  test('each Durable consumer hands its Handler one Message at a time; the second waits until the first is settled', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const gate = aGate();
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds));
    await orders.consume(handlersOf(received, { charge: () => gate.opened }), {});
    await orders.sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    await vi.advanceTimersByTimeAsync(1_000);
    await orders.sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-2' });

    await vi.advanceTimersByTimeAsync(1_000);
    const whileFirstRuns = received.length;
    gate.open();
    await vi.advanceTimersByTimeAsync(1_000);

    expect([whileFirstRuns, received.length]).toEqual([1, 2]);
  });

  test('the Handlers of two Durable consumers run at the same time', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds));
    const gate = aGate();
    const holding: Behavior = () => gate.opened;
    await orders.consume(handlersOf(received, { charge: holding, notify: holding }), {});
    await orders.sender.send('ChargeCard', order, { factId: 'f-1' });
    await orders.publisher.publish('OrderCreated', { v1: order }, { factId: 'f-2' });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(received.map(({ handler }) => handler).sort()).toEqual([
      'ChargeCard@1',
      'notifyOnCreated',
    ]);
  });

  test('publish answers no duplicate, and the same Fact id published twice is delivered twice', async () => {
    const received: Received[] = [];
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds));
    await orders.consume(handlersOf(received), {});

    const first = await orders.publisher.publish('OrderCreated', { v1: order }, { factId: 'f-1' });
    const second = await orders.publisher.publish('OrderCreated', { v1: order }, { factId: 'f-1' });

    await until(() => expect(received).toHaveLength(2));
    expect([first.duplicates, second.duplicates]).toEqual([[], []]);
  });

  test('a Message published before consume reaches no Handler', async () => {
    vi.useFakeTimers();
    const received: Received[] = [];
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds));
    await orders.sender.send('ChargeCard', { orderId: 'before' }, { factId: 'f-1' });

    await orders.consume(handlersOf(received), {});
    await orders.sender.send('ChargeCard', { orderId: 'after' }, { factId: 'f-2' });
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(received.map(({ body }) => body)).toEqual([{ orderId: 'after' }]);
  });

  test('an Event no Subscription takes reaches no Handler and writes nothing to the console', async () => {
    vi.useFakeTimers();
    const printed = (['log', 'warn', 'error'] as const).map((method) => printedBy(method));
    const received: Received[] = [];
    const billing = await aMessagingOver(billingContract, inProcess(thirtySeconds));
    await billing.consume(billingHandlersOf(received), {});

    await billing.publisher.publish('InvoiceIssued', { v1: order }, { factId: 'f-1' });
    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(received).toEqual([]);
    expect(printed).toEqual([[], [], []]);
  });

  test('two Services connected through one inProcess(): an Event the first publishes reaches the second’s Subscription', async () => {
    const received: Received[] = [];
    const broker = inProcess(thirtySeconds);
    const orders = await aMessagingOver(ordersContract, broker);
    const billing = await aMessagingOver(billingContract, broker);
    await billing.consume(billingHandlersOf(received), {});

    await orders.publisher.publish('OrderCreated', { v1: order }, { factId: 'f-1' });

    await until(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ handler: 'invoiceOnCreated', body: order });
  });

  test('two connections of one Service consuming through one inProcess() share a Durable consumer’s Messages, each handled once', async () => {
    vi.useFakeTimers();
    const gate = aGate();
    const holding: Behavior = () => gate.opened;
    const broker = inProcess(thirtySeconds);
    const first = await aMessagingOver(ordersContract, broker);
    const second = await aMessagingOver(ordersContract, broker);
    const receivedByFirst: Received[] = [];
    const receivedBySecond: Received[] = [];
    await first.consume(handlersOf(receivedByFirst, { charge: holding }), {});
    await second.consume(handlersOf(receivedBySecond, { charge: holding }), {});
    await first.sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    await first.sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-2' });

    await vi.advanceTimersByTimeAsync(1_000);
    gate.open();
    await vi.advanceTimersByTimeAsync(3_600_000);

    const handled = [...receivedByFirst, ...receivedBySecond].map(({ body }) => body);
    expect([receivedByFirst.length, receivedBySecond.length]).toEqual([1, 1]);
    expect(handled).toEqual(expect.arrayContaining([{ orderId: 'o-1' }, { orderId: 'o-2' }]));
  });

  describe('one durable on two subjects, as two Releases of one Service in one process hand it', () => {
    const subjectOf = (release: string) => `orders-service.command.Charge${release}.v1`;

    /** A Durable consumer of the one `durable` on this release's subject, noting what reaches it. */
    function consumerOn(release: string, received: string[]): DurableConsumer {
      const receive = async ({ messageId }: Delivery) => {
        received.push(`${release} ${messageId}`);
        return 'acked' as const;
      };
      const subject = subjectOf(release);
      return { durable: 'orders-service_charge', stream: 'orders-service', subject, receive };
    }

    const aMessageOn = (release: string, messageId: string): OutgoingMessage => ({
      subject: subjectOf(release),
      messageId,
      factId: 'f-1',
      headers: {},
      body: new TextEncoder().encode('{"orderId":"o-1"}'),
    });

    const consuming = { closing: new AbortController().signal, troubled: () => undefined };

    test('two connections consuming it: a publish to each subject reaches its own Durable consumer', async () => {
      vi.useFakeTimers();
      const broker = inProcess(thirtySeconds);
      const received: string[] = [];
      const first = await broker.connect({ stream: 'orders-service', subjects: [] });
      const second = await broker.connect({ stream: 'orders-service', subjects: [] });
      await first.consume([consumerOn('First', received)], consuming);
      await second.consume([consumerOn('Second', received)], consuming);

      await first.publish(aMessageOn('First', 'm-1'));
      await first.publish(aMessageOn('Second', 'm-2'));
      await vi.advanceTimersByTimeAsync(1_000);

      expect(received.sort()).toEqual(['First m-1', 'Second m-2']);
    });

    test('one consume handed both: each resolves, and a publish to each subject reaches its own Durable consumer', async () => {
      vi.useFakeTimers();
      const broker = inProcess(thirtySeconds);
      const received: string[] = [];
      const connection = await broker.connect({ stream: 'orders-service', subjects: [] });
      const both = [consumerOn('First', received), consumerOn('Second', received)];
      await connection.consume(both, consuming);

      await connection.publish(aMessageOn('First', 'm-1'));
      await connection.publish(aMessageOn('Second', 'm-2'));
      await vi.advanceTimersByTimeAsync(1_000);

      expect(received.sort()).toEqual(['First m-1', 'Second m-2']);
    });
  });

  test('a Handler that publishes the Event it handles keeps going, while a node:http server in the same process still answers', async () => {
    const server = createServer((_request, response) => {
      answered = true;
      response.end('answered');
    });
    onTestFinished(() => void server.close());
    let answered = false;
    const cap = 100_000;
    let handled = 0;
    const orders = await aMessagingOver(ordersContract, inProcess(thirtySeconds));
    const republishing: Behavior = async () => {
      handled += 1;
      if (!answered && handled < cap) {
        const factId = `f-${handled}`;
        await orders.publisher.publish('OrderCreated', { v1: { orderId: factId } }, { factId });
      }
      return undefined;
    };
    await orders.consume(handlersOf([], { notify: republishing }), {});
    await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    await orders.publisher.publish('OrderCreated', { v1: order }, { factId: 'f-0' });
    const response = await fetch(`http://127.0.0.1:${port}/`);

    expect(await response.text()).toBe('answered');
    expect(handled).toBeLessThan(cap);
  });
});
