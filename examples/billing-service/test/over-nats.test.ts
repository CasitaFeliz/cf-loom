import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { aNatsServer, type NatsServer } from '../../../packages/messaging/test/nats-server.ts';
import { billingEnvironment, brokerPrefix, ordersEnvironment } from './environments.ts';
import {
  applyPlanOf,
  type DurableConsumerState,
  durableConsumerStateOf,
  lastMessageOn,
} from './nats-broker.ts';
import { placeAnOrder } from './placing-an-order.ts';
import { aServiceProcess, type ServiceProcess } from './service-process.ts';

const ordersDir = join(import.meta.dirname, '../../orders-service');
const billingDir = join(import.meta.dirname, '..');
const stream = `${brokerPrefix}_orders-service`;
const createdSubject = `${brokerPrefix}.orders-service.event.OrderCreated.v1`;
const chargeSubject = `${brokerPrefix}.orders-service.command.ChargeCard.v1`;
const billingDrafting = `${brokerPrefix}_billing-service_draft-invoice-on-created`;
const ordersCharging = `${brokerPrefix}_orders-service_charge-on-created`;
const ordersHandlingCharge = `${brokerPrefix}_orders-service_command_ChargeCard_v1`;
const patience = { interval: 50, timeout: 15_000 };
let nats: NatsServer | undefined;
let orders: ServiceProcess | undefined;
let billing: ServiceProcess | undefined;
let ordersUrl = '';

beforeAll(async () => {
  const server = await aNatsServer();
  nats = server;
  await applyPlanOf(ordersDir, server.url, brokerPrefix);
  await applyPlanOf(billingDir, server.url, brokerPrefix);
  orders = await aServiceProcess(ordersDir, ordersEnvironment(server.url));
  ordersUrl = `http://127.0.0.1:${orders.port}`;
  billing = await aServiceProcess(billingDir, billingEnvironment(server.url, ordersUrl));
});

afterAll(async () => {
  await Promise.all([billing?.stop(), orders?.stop()]);
  await nats?.stop();
});

/** What the Services wrote to stderr, to show with a wait that timed out. */
function stderrOfServices(): string {
  return `orders-service stderr: ${orders?.stderr()}\nbilling-service stderr: ${billing?.stderr()}`;
}

/** The stream sequence of the Message a Fact id sent on a subject, once the stream holds it as the last there. */
function sequenceOf(subject: string, factId: string): Promise<number> {
  return vi.waitFor(async () => {
    const last = await lastMessageOn(nats!.url, stream, subject);
    if (last?.factId !== factId) {
      const held = last?.factId ?? 'nothing';
      throw new Error(`${subject} holds ${held}, not ${factId}\n${stderrOfServices()}`);
    }
    return last.seq;
  }, patience);
}

/** What a Durable consumer holds once it has settled every Message up to a stream sequence. */
function stateOnceSettled(durable: string, sequence: number): Promise<DurableConsumerState> {
  return vi.waitFor(async () => {
    const state = await durableConsumerStateOf(nats!.url, stream, durable);
    if (state.ackFloor < sequence) {
      const settled = `${durable} settled up to ${state.ackFloor}, not ${sequence}`;
      throw new Error(`${settled}\n${stderrOfServices()}`);
    }
    return state;
  }, patience);
}

describe('orders-service and billing-service over NATS JetStream', () => {
  test('an order placed over HTTP reaches billing’s Subscription through the Broker', async () => {
    const orderId = await placeAnOrder(ordersUrl);

    const created = await sequenceOf(createdSubject, `${orderId}:created`);
    const drafting = await stateOnceSettled(billingDrafting, created);

    expect(drafting).toMatchObject({ pending: 0, ackPending: 0, redelivered: 0 });
  });

  test('orders’ own Subscription sends ChargeCard and orders’ Message Handler handles it', async () => {
    const orderId = await placeAnOrder(ordersUrl);

    const created = await sequenceOf(createdSubject, `${orderId}:created`);
    const charge = await sequenceOf(chargeSubject, `${orderId}:charge`);
    const sending = await stateOnceSettled(ordersCharging, created);
    const handling = await stateOnceSettled(ordersHandlingCharge, charge);

    expect(sending).toMatchObject({ pending: 0, ackPending: 0, redelivered: 0 });
    expect(handling).toMatchObject({ pending: 0, ackPending: 0, redelivered: 0 });
  });

  test('neither Service writes a line about the order’s Messages to stderr', async () => {
    const orderId = await placeAnOrder(ordersUrl);

    const created = await sequenceOf(createdSubject, `${orderId}:created`);
    const charge = await sequenceOf(chargeSubject, `${orderId}:charge`);
    await stateOnceSettled(billingDrafting, created);
    await stateOnceSettled(ordersCharging, created);
    await stateOnceSettled(ordersHandlingCharge, charge);

    expect(orders!.stderr()).not.toContain(orderId);
    expect(billing!.stderr()).not.toContain(orderId);
  });

  test('orders-service exits with status 0 when it is sent SIGTERM as soon as it listens', async () => {
    const ordersToStop = await aServiceProcess(ordersDir, ordersEnvironment(nats!.url));

    const exit = await ordersToStop.stop();

    expect(exit).toEqual({ status: 0, signal: null });
  });

  test('billing-service exits with status 0 when it is sent SIGTERM as soon as it listens', async () => {
    const billingToStop = await aServiceProcess(
      billingDir,
      billingEnvironment(nats!.url, ordersUrl),
    );

    const exit = await billingToStop.stop();

    expect(exit).toEqual({ status: 0, signal: null });
  });
});
