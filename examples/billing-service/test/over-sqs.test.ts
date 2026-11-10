import { sqs } from '@cf-loom/messaging/sqs';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { printedBy } from '../../../packages/contract/test/printed.ts';
import { wakeEach } from '../../../packages/messaging/test/aws-arranging.ts';
import { motoClientsAt } from '../../../packages/messaging/test/aws-connecting.ts';
import { queueCountsOf } from '../../../packages/messaging/test/aws-reading.ts';
import { aMotoServer, type MotoServer } from '../../../packages/messaging/test/moto-server.ts';
import { until } from '../../../packages/messaging/test/until.ts';
import { chargesOf } from '../../orders-service/src/charges/charges.ts';
import { draftsOf } from '../src/billing/drafts.ts';
import { brokerPrefix } from './environments.ts';
import {
  billingDir,
  billingDrafting,
  ORDER_TOTAL,
  ordersCharging,
  ordersDir,
  ordersHandlingCharge,
  placeAnOrder,
} from './order-scenario.ts';
import { billingOver, ordersOver, type RunningService } from './services-over-a-broker.ts';
import { applyPlanOf } from './sqs-broker.ts';

let moto: MotoServer | undefined;
let clients: ReturnType<typeof motoClientsAt>[] = [];
let reader: ReturnType<typeof motoClientsAt>;
let orders: RunningService | undefined;
let billing: RunningService | undefined;
/** What `console.error` prints since both Services started; Vitest clears a spy's own record before each test, never this list. */
let errorsPrinted: readonly string[] = [];
/** What `console.warn` prints since both Services started, kept as `errorsPrinted` is. */
let warningsPrinted: readonly string[] = [];

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
  errorsPrinted = printedBy('error');
  warningsPrinted = printedBy('warn');
});

afterEach((context) => {
  if (context.task.result?.state === 'fail') {
    process.stderr.write(`${printedLines().join('\n')}\n`);
  }
});

afterAll(async () => {
  try {
    const closing = Promise.all([orders?.close(), billing?.close()]);
    if (orders !== undefined) {
      await wakeEach(reader.sqs, [billingDrafting, ordersCharging, ordersHandlingCharge]);
    }
    await closing;
  } finally {
    for (const connecting of clients) {
      connecting.sns.destroy();
      connecting.sqs.destroy();
    }
    await moto?.stop();
  }
  expectNoLinePrinted();
});

/** Each line printed since both Services started, with the method that printed it. */
function printedLines(): string[] {
  return [
    ...errorsPrinted.map((line) => `console.error: ${line}`),
    ...warningsPrinted.map((line) => `console.warn: ${line}`),
  ];
}

/** Fails when either Service printed a line, naming the method. */
function expectNoLinePrinted(): void {
  expect({ error: errorsPrinted, warn: warningsPrinted }).toEqual({ error: [], warn: [] });
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
    const orderId = await placeAnOrder(orders!.url);

    await until(() => expect(draftsOf(orderId)).toEqual([{ orderId, total: ORDER_TOTAL }]));
    await untilDeleted(billingDrafting);
  });

  test('orders’ own Subscription sends ChargeCard through SNS and SQS, and orders’ Message Handler charges the order', async () => {
    const orderId = await placeAnOrder(orders!.url);

    await until(() => expect(chargesOf(orderId)).toEqual([{ orderId, total: ORDER_TOTAL }]));
    await untilDeleted(ordersCharging);
    await untilDeleted(ordersHandlingCharge);
  });

  test('neither Service writes a console line about the order’s Messages', async () => {
    const orderId = await placeAnOrder(orders!.url);

    await until(() => expect(draftsOf(orderId)).toHaveLength(1));
    await until(() => expect(chargesOf(orderId)).toHaveLength(1));
    await untilDeleted(billingDrafting);
    await untilDeleted(ordersCharging);
    await untilDeleted(ordersHandlingCharge);

    expectNoLinePrinted();
  });
});
