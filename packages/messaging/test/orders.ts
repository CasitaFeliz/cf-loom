import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  type ServiceContract,
} from '@cf-loom/contract';
import { handle, type MessageFault, type MessageMeta, readersOf } from '@cf-loom/handlers';
import { z } from 'zod';
import { applyBrokerPlan, type SqsBrokerLimits, type SqsConnecting } from '../src/sqs/index.ts';
import { planOf } from './broker-plans.ts';

const orderBody = z.object({ orderId: z.string() });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was created',
  body: orderBody,
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: orderBody,
});

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV1,
});

/** A Service that publishes an Event, sends a Command and handles both. */
export const ordersContract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1],
      commands: [chargeCardV1],
      subscriptions: [notifyOnCreated],
    }),
  ],
});

/** The same Service without the Subscription, so only its Command needs a Durable consumer. */
export const ordersWithoutSubscription = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1],
      commands: [chargeCardV1],
    }),
  ],
});

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was created, with its total',
  body: z.object({ orderId: z.string(), total: z.number() }),
});

/** A Service that publishes two live versions of an Event. */
export const ordersWithTwoVersions = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1, orderCreatedV2],
      commands: [chargeCardV1],
    }),
  ],
});

/** The Readers of Orders' Commands and Subscriptions. */
export const ordersReaders = readersOf({
  commands: { chargeCardV1: { declaration: chargeCardV1, reader: orderBody } },
  subscriptions: { notifyOnCreated: { declaration: notifyOnCreated, reader: orderBody } },
});

/** Every setting a Durable consumer's queue needs. */
export const testLimits: SqsBrokerLimits = {
  durableConsumerDefaults: {
    ackWait: '30s',
    maxDeliver: 5,
    retention: '4d',
    deadLetterRetention: '14d',
  },
};

/** Orders’ names under a prefix: its topic, its subjects, its two Durable consumers and their queues. */
export function anOrders(prefix: string | null = null) {
  const named = (name: string) => (prefix === null ? name : `${prefix}_${name}`);
  const subjectNamed = (subject: string) => (prefix === null ? subject : `${prefix}.${subject}`);
  const notifyDurable = named('orders-service_notify-on-created');
  const chargeDurable = named('orders-service_command_ChargeCard_v1');
  return {
    stream: named('orders-service'),
    created: subjectNamed('orders-service.event.OrderCreated.v1'),
    charge: subjectNamed('orders-service.command.ChargeCard.v1'),
    notifyDurable,
    chargeDurable,
    notifyQueue: notifyDurable,
    chargeQueue: chargeDurable,
  };
}

/** Orders’ topic and queues on the Broker, as the organization's `applyBrokerPlan` makes them. */
export async function arrangeOrders(
  connecting: SqsConnecting,
  settings: {
    readonly prefix?: string | null;
    readonly limits?: SqsBrokerLimits;
    readonly contract?: ServiceContract;
  } = {},
): Promise<void> {
  const { prefix = null, limits = testLimits, contract = ordersContract } = settings;
  await applyBrokerPlan(connecting, planOf(contract, prefix), limits);
}

/** What a Handler of Orders received. */
export type Received = {
  readonly handler: string;
  readonly body: unknown;
  readonly meta: MessageMeta;
};

/** What a Handler does after recording its Message. */
export type Behavior = (
  received: Received,
) => Promise<MessageFault | undefined> | MessageFault | undefined;

/** The Handler map of Orders, each Handler recording what it receives and then doing as its behavior says. */
export function handlersOf(
  received: Received[],
  behaviors: { notify?: Behavior; charge?: Behavior } = {},
) {
  const recording = (handler: string, behavior: Behavior | undefined) => {
    return async (body: unknown, meta: MessageMeta): Promise<MessageFault | undefined> => {
      const entry = { handler, body, meta };
      received.push(entry);
      return await behavior?.(entry);
    };
  };
  return {
    commands: {
      chargeCardV1: handle(
        ordersReaders.commands.chargeCardV1,
        recording('ChargeCard@1', behaviors.charge),
      ),
    },
    subscriptions: {
      notifyOnCreated: handle(
        ordersReaders.subscriptions.notifyOnCreated,
        recording('notifyOnCreated', behaviors.notify),
      ),
    },
    readers: ordersReaders,
  };
}

/** The name of a Command whose Durable consumer's name, under the prefix `staging`, is longer than a queue's name may be. */
export const longCommandName = 'ChargeTheCustomersDefaultCardOnTheFirstDayOfEveryMonth';

const chargeTheCustomersDefaultCardOnTheFirstDayOfEveryMonthV1 = defineCommand({
  name: longCommandName,
  version: 1,
  description: 'Charges the order’s card',
  body: orderBody,
});

/** A Service that sends and handles the one Command of the long name. */
export const ordersWithLongCommand = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      commands: [chargeTheCustomersDefaultCardOnTheFirstDayOfEveryMonthV1],
    }),
  ],
});

const longReaders = readersOf({
  commands: {
    chargeTheCustomersDefaultCardOnTheFirstDayOfEveryMonthV1: {
      declaration: chargeTheCustomersDefaultCardOnTheFirstDayOfEveryMonthV1,
      reader: orderBody,
    },
  },
  subscriptions: {},
});

/** The Handler map of the Service with the long-named Command, its Handler recording what it receives. */
export function longHandlersOf(received: Received[]) {
  const record = async (body: unknown, meta: MessageMeta): Promise<undefined> => {
    received.push({ handler: longCommandName, body, meta });
    return undefined;
  };
  return {
    commands: {
      chargeTheCustomersDefaultCardOnTheFirstDayOfEveryMonthV1: handle(
        longReaders.commands.chargeTheCustomersDefaultCardOnTheFirstDayOfEveryMonthV1,
        record,
      ),
    },
    subscriptions: {},
    readers: longReaders,
  };
}
