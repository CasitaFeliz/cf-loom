import { join } from 'node:path';
import { sqs } from '@cf-loom/messaging/sqs';
import { afterAll, beforeAll, describe, expect, type MockInstance, test, vi } from 'vitest';
import { wakeEach } from '../../../packages/messaging/test/aws-arranging.ts';
import { motoClientsAt } from '../../../packages/messaging/test/aws-connecting.ts';
import { queueCountsOf } from '../../../packages/messaging/test/aws-reading.ts';
import { aMotoServer, type MotoServer } from '../../../packages/messaging/test/moto-server.ts';
import { until } from '../../../packages/messaging/test/until.ts';
import { draftsOf } from '../src/billing/drafts.ts';
import { brokerPrefix } from './environments.ts';
import { billingOver, ordersOver, type RunningService } from './services-over-a-broker.ts';
import { applyPlanOf } from './sqs-broker.ts';

const ordersDir = join(import.meta.dirname, '../../orders-service');
const billingDir = join(import.meta.dirname, '..');
const billingDrafting = `${brokerPrefix}_billing-service_draft-invoice-on-created`;
const ordersCharging = `${brokerPrefix}_orders-service_charge-on-created`;
const ordersHandlingCharge = `${brokerPrefix}_orders-service_command_ChargeCard_v1`;
const CUSTOMER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const TOTAL = { amount: 990, currency: 'EUR' };
let moto: MotoServer | undefined;
let clients: ReturnType<typeof motoClientsAt>[] = [];
let reader: ReturnType<typeof motoClientsAt>;
let orders: RunningService | undefined;
let billing: RunningService | undefined;
let consoleErrors: MockInstance<typeof console.error>;

beforeAll(async () => {
  const server = await aMotoServer();
  moto = server;
  const ordersConnecting = motoClientsAt(server.url);
  const billingConnecting = motoClientsAt(server.url);
  reader = motoClientsAt(server.url);
  clients = [ordersConnecting, billingConnecting, reader];
  await applyPlanOf(ordersDir, reader, brokerPrefix);
  await applyPlanOf(billingDir, reader, brokerPrefix);
  orders = await ordersOver(sqs({ ...ordersConnecting, prefix: brokerPrefix }));
  billing = await billingOver(sqs({ ...billingConnecting, prefix: brokerPrefix }), orders.url);
  consoleErrors = vi.spyOn(console, 'error');
});

afterAll(async () => {
  try {
    const closing = Promise.all([orders?.close(), billing?.close()]);
    await wakeEach(reader.sqs, [billingDrafting, ordersCharging, ordersHandlingCharge]);
    await closing;
  } finally {
    for (const connecting of clients) {
      connecting.sns.destroy();
      connecting.sqs.destroy();
    }
    await moto?.stop();
    consoleErrors?.mockRestore();
  }
});

/** Places an order over HTTP, as a Caller would, and answers its id. */
async function placeAnOrder(): Promise<string> {
  const response = await fetch(`${orders!.url}/orders`, {
    method: 'POST',
    headers: { 'x-api-key': 'billing-key', 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: CUSTOMER_ID, total: TOTAL }),
  });
  const placed = (await response.json()) as { readonly id: string };
  return placed.id;
}

/** Waits until the queue named `queue` and its dead-letter queue hold no Message, so every Delivery from it was deleted and none was set aside. */
function untilDeleted(queue: string): Promise<void> {
  return until(async () => {
    const held = await queueCountsOf(reader.sqs, queue);
    const dead = await queueCountsOf(reader.sqs, `${queue}_dlq`);
    const deadLettered = dead.visible + dead.inFlight;
    expect({ ...held, deadLettered }).toEqual({ visible: 0, inFlight: 0, deadLettered: 0 });
  });
}

describe('orders-service and billing-service over SNS/SQS', () => {
  test('an order placed over HTTP reaches billing’s Subscription through SNS and SQS, which drafts its invoice and deletes the Message', async () => {
    const orderId = await placeAnOrder();

    await until(() => expect(draftsOf(orderId)).toEqual([{ orderId, total: TOTAL }]));
    await untilDeleted(billingDrafting);
  });
});
