import { afterAll, beforeAll, beforeEach, describe, expect, onTestFinished, test } from 'vitest';
import { anAwsConnecting, failingCommand } from '../../test/aws-clients.ts';
import { attributesReceivedFrom, receivedFrom } from '../../test/aws-reading.ts';
import { aMotoServer, type MotoServer } from '../../test/moto-server.ts';
import {
  arrangeOrders,
  handlersOf,
  ordersContract,
  ordersWithTwoVersions,
  type Received,
} from '../../test/orders.ts';
import { anOrdersMessaging } from '../../test/orders-messaging.ts';
import { until } from '../../test/until.ts';
import { MessageNotSentError, messaging } from '../index.ts';
import { memory } from '../memory/index.ts';
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
function aMessaging() {
  return anOrdersMessaging(moto.url);
}

describe('publishing over sqs()', () => {
  test('publish sends each Message to the Service’s topic with the prefixed subject in cf-loom-subject, and it reaches the queue subscribed to that subject', async () => {
    const { publisher, connecting, orders } = await aMessaging();

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'o-1:created' });

    const received = await receivedFrom(connecting.sqs, orders.notifyQueue);
    expect(received).toEqual([{ body: '{"orderId":"o-1"}', subject: orders.created }]);
    await expect(receivedFrom(connecting.sqs, orders.chargeQueue)).resolves.toEqual([]);
  });

  test('the Broker message id, Fact id and Transport headers arrive as ASCII JSON in their attributes', async () => {
    const { publisher, connecting, orders } = await aMessaging();

    await publisher.publish(
      'OrderCreated',
      { v1: { orderId: 'o-1' } },
      { factId: 'o-1:created', headers: { traceparent: '00-abc-def-01' } },
    );

    await expect(attributesReceivedFrom(connecting.sqs, orders.notifyQueue)).resolves.toEqual([
      {
        'cf-loom-subject': orders.created,
        'cf-loom-message-id': '"event.OrderCreated.v1:o-1:created"',
        'cf-loom-fact-id': '"o-1:created"',
        'cf-loom-headers': '{"traceparent":"00-abc-def-01"}',
      },
    ]);
  });

  test('a Message with no Transport headers carries cf-loom-headers {}', async () => {
    const { publisher, connecting, orders } = await aMessaging();

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'o-1' });

    const [attributes] = await attributesReceivedFrom(connecting.sqs, orders.notifyQueue);
    expect(attributes?.['cf-loom-headers']).toBe('{}');
  });

  test('publish and send resolve with no duplicates, and publishing the same Fact id again delivers the Message again', async () => {
    const { publisher, sender, connecting, orders } = await aMessaging();

    const first = await publisher.publish(
      'OrderCreated',
      { v1: { orderId: 'o-1' } },
      { factId: 'f' },
    );
    const again = await publisher.publish(
      'OrderCreated',
      { v1: { orderId: 'o-1' } },
      { factId: 'f' },
    );
    const sent = await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f' });

    expect([first, again]).toEqual([
      { factId: 'f', duplicates: [] },
      { factId: 'f', duplicates: [] },
    ]);
    expect(sent).toEqual({ factId: 'f', duplicate: false });
    const received = await receivedFrom(connecting.sqs, orders.notifyQueue);
    expect(received.map(({ body }) => body)).toEqual(['{"orderId":"o-1"}', '{"orderId":"o-1"}']);
  });

  test('the body reaches the queue as its UTF-8 JSON text, astral characters included', async () => {
    const { publisher, connecting, orders } = await aMessaging();

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-\u{1f600}-é' } }, { factId: 'f' });

    const received = await receivedFrom(connecting.sqs, orders.notifyQueue);
    expect(received.map(({ body }) => body)).toEqual(['{"orderId":"o-\u{1f600}-é"}']);
  });

  test('an SNS client that fails rejects publish with MessageNotSentError naming the versions already sent, with the client’s error as cause', async () => {
    const connecting = anAwsConnecting(moto.url);
    const refusal = new Error('SNS is down');
    await arrangeOrders(connecting, { contract: ordersWithTwoVersions });
    failingCommand(connecting.sns, { command: 'PublishCommand', error: refusal, after: 1 });
    const { publisher } = await messaging(ordersWithTwoVersions, sqs(connecting));
    const bodies = { v1: { orderId: 'o-1' }, v2: { orderId: 'o-1', total: 12 } };

    const error = await publisher.publish('OrderCreated', bodies, { factId: 'f' }).then(
      () => undefined,
      (rejected: unknown) => rejected,
    );

    expect(error).toBeInstanceOf(MessageNotSentError);
    expect(error).toMatchObject({ factId: 'f', sent: ['OrderCreated@2'] });
    expect((error as Error).cause).toBe(refusal);
  });

  test('a Fact id and Transport headers holding astral characters, controls, U+FFFE, quotes and backslashes reach the Handler as given, over sqs() as over memory()', async () => {
    const given = {
      factId: 'pedido \u{1f600} "1" \\ \u{fffe}\u{ffff} \u0001',
      headers: {
        'x-note': 'café  con\tleche "así" \\n',
        'x-ctl': 'a\u0001b\u001f\u007fc',
        'x-text': '日本 \u{1f389} \u{fffe}',
        'x-empty': '',
        'x-trace': 'A',
        'X-Trace': 'B',
        constructor: 'c',
      },
    };
    const { publisher, consume } = await aMessaging();
    const overSqs: Received[] = [];
    await consume(handlersOf(overSqs), {});
    const inMemory = await memory(ordersContract);
    onTestFinished(() => inMemory.close());
    const overMemory: Received[] = [];
    await inMemory.consume(handlersOf(overMemory), {});

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, given);
    await inMemory.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, given);
    await inMemory.settled();

    await until(() => expect(overSqs).toHaveLength(1));
    const seenOf = (received: Received[]) => ({
      factId: received[0]?.meta.factId,
      headers: received[0]?.meta.headers,
    });
    expect(seenOf(overMemory)).toEqual(given);
    expect(seenOf(overSqs)).toEqual(given);
  });
});
