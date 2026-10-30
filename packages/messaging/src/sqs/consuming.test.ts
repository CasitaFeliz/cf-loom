import { afterAll, beforeAll, beforeEach, describe, expect, onTestFinished, test } from 'vitest';
import { wakeEach } from '../../test/aws-arranging.ts';
import { anAwsConnecting } from '../../test/aws-clients.ts';
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
import { sqs } from './index.ts';

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

/** An Orders messaging over sqs() on the test's moto, closed when the test ends, with the names it works with. */
async function aMessaging(prefix: string | null = 'staging') {
  const connecting = anAwsConnecting(moto.url);
  await arrangeOrders(connecting, { prefix });
  const orders = anOrders(prefix);
  const started = await messaging(
    ordersContract,
    sqs(prefix === null ? connecting : { ...connecting, prefix }),
  );
  onTestFinished(async () => {
    const closing = started.close();
    await wakeEach(connecting.sqs, [orders.notifyQueue, orders.chargeQueue]);
    await closing.catch(() => undefined);
  });
  return { ...started, connecting, orders };
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
});
