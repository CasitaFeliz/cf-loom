import { defineService } from '@cf-loom/contract';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { aClosedUrl, anAwsConnecting } from '../../test/aws-clients.ts';
import { aMotoServer, type MotoServer } from '../../test/moto-server.ts';
import { arrangeOrders, ordersContract } from '../../test/orders.ts';
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

describe('sqs()', () => {
  test('messaging() over sqs() connects when the Service’s prefixed SNS topic exists', async () => {
    const connecting = anAwsConnecting(moto.url);
    await arrangeOrders(connecting, { prefix: 'staging' });

    const opening = messaging(ordersContract, sqs({ ...connecting, prefix: 'staging' }));

    await expect(opening).resolves.toBeDefined();
  });

  test('messaging() rejects naming the stream and its topic ARN, saying to apply the Broker plan, when the topic does not exist', async () => {
    const connecting = anAwsConnecting(moto.url);

    const opening = messaging(ordersContract, sqs({ ...connecting, prefix: 'staging' }));

    await expect(opening).rejects.toThrow(
      `The stream staging_orders-service has no SNS topic arn:aws:sns:eu-west-1:123456789012:staging_orders-service: apply the Service's Broker plan`,
    );
  });

  test('a Service that publishes and sends nothing connects with no topic at all', async () => {
    const connecting = anAwsConnecting(moto.url);
    const quiet = defineService({ name: 'quiet-service' });

    const opening = messaging(quiet, sqs(connecting));

    await expect(opening).resolves.toBeDefined();
  });

  test('any other error of the topic check rejects messaging() unchanged', async () => {
    const connecting = anAwsConnecting(await aClosedUrl(), { sqsUrl: moto.url });

    const opening = messaging(ordersContract, sqs(connecting));

    await expect(opening).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  test.each(['stag_ing', 'a.b', 'Staging', '', 'a'.repeat(65)])(
    'sqs() refuses the prefix "%s", which is not a Broker prefix, naming it and saying to leave it undefined for none',
    (prefix) => {
      const connecting = anAwsConnecting(moto.url);

      const broker = () => sqs({ ...connecting, prefix });

      expect(broker).toThrow(
        `The broker prefix "${prefix}" is not kebab-case of at most 64 characters, such as staging: leave prefix undefined for none`,
      );
    },
  );

  test('without a prefix, messaging() checks the topic named after the Service', async () => {
    const connecting = anAwsConnecting(moto.url);
    await arrangeOrders(connecting);

    const opening = messaging(ordersContract, sqs(connecting));

    await expect(opening).resolves.toBeDefined();
  });
});
