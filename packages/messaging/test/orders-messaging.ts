import { onTestFinished } from 'vitest';
import { type BrokerTrouble, type ConsumedFault, messaging } from '../src/index.ts';
import {
  type SqsBrokerLimits,
  type SqsConnecting,
  type SqsDurableConsumerLimits,
  sqs,
} from '../src/sqs/index.ts';
import { wakeEach } from './aws-arranging.ts';
import { anAwsConnecting } from './aws-clients.ts';
import { anOrders, arrangeOrders, ordersContract, testLimits } from './orders.ts';

/** Closes a messaging when the test ends, waking its open polls so the closing does not wait them out. */
export function closedWhenDone(
  started: { readonly close: () => Promise<void> },
  connecting: SqsConnecting,
  orders: Pick<ReturnType<typeof anOrders>, 'notifyQueue' | 'chargeQueue'> = anOrders('staging'),
): void {
  onTestFinished(async () => {
    const closing = started.close();
    for (const queue of [orders.notifyQueue, orders.chargeQueue]) {
      await wakeEach(connecting.sqs, [queue]).catch(() => undefined);
    }
    await closing.catch(() => undefined);
  });
}

/** What a test of Orders over sqs() may set: its Broker prefix, the limits its queues are made with and the hooks of its messaging. */
export type Settings = {
  readonly prefix?: string | null;
  readonly limits?: SqsBrokerLimits;
  readonly onServiceFault?: (fault: ConsumedFault) => void | Promise<void>;
  readonly onBrokerTrouble?: (trouble: BrokerTrouble) => void | Promise<void>;
};

/** An Orders messaging over sqs() on the moto server at `url`, its topic and queues made by `applyBrokerPlan` and the messaging closed when the test ends, with the names it works with. */
export async function anOrdersMessaging(url: string, settings: Settings = {}) {
  const { prefix = 'staging', limits } = settings;
  const connecting = anAwsConnecting(url);
  await arrangeOrders(connecting, { prefix, ...(limits === undefined ? {} : { limits }) });
  const started = await orderMessagingOver(connecting, settings);
  return { ...started, connecting };
}

/** Another messaging of Orders over clients that have already made its queues, as a next process of the Service would start. */
export async function orderMessagingOver(connecting: SqsConnecting, settings: Settings = {}) {
  const { prefix = 'staging', onServiceFault, onBrokerTrouble } = settings;
  const hooks = {
    onServiceFault: onServiceFault ?? (() => undefined),
    onBrokerTrouble: onBrokerTrouble ?? (() => undefined),
  };
  const broker = sqs(prefix === null ? connecting : { ...connecting, prefix });
  const started = await messaging(ordersContract, broker, hooks);
  const orders = anOrders(prefix);
  closedWhenDone(started, connecting, orders);
  return { ...started, orders };
}

/** The limits of the test's queues with these settings of a Durable consumer over the default ones. */
export function limitsWith(settings: Partial<SqsDurableConsumerLimits>): SqsBrokerLimits {
  return { durableConsumerDefaults: { ...testLimits.durableConsumerDefaults, ...settings } };
}
