import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { anAwsConnecting } from '../../test/aws-clients.ts';
import { receivedFrom } from '../../test/aws-reading.ts';
import { aMotoServer, type MotoServer } from '../../test/moto-server.ts';
import { anOrders, arrangeOrders, ordersContract } from '../../test/orders.ts';
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

/** A messaging() over sqs() whose topic and queues the Service's Broker plan describes, under a prefix. */
async function aMessaging(prefix: string | null = 'staging') {
  const connecting = anAwsConnecting(moto.url);
  await arrangeOrders(connecting, { prefix });
  const started = await messaging(
    ordersContract,
    sqs(prefix === null ? connecting : { ...connecting, prefix }),
  );
  return { ...started, connecting, orders: anOrders(prefix) };
}

describe('publishing over sqs()', () => {
  test('publish sends each Message to the Service’s topic with the prefixed subject in cf-loom-subject, and it reaches the queue subscribed to that subject', async () => {
    const { publisher, connecting, orders } = await aMessaging();

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'o-1:created' });

    const received = await receivedFrom(connecting.sqs, orders.notifyQueue);
    expect(received).toEqual([{ body: '{"orderId":"o-1"}', subject: orders.created }]);
    await expect(receivedFrom(connecting.sqs, orders.chargeQueue)).resolves.toEqual([]);
  });
});
