import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { anAwsConnecting } from '../../test/aws-clients.ts';
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
});
