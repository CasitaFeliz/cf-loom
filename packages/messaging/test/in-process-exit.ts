import { setTimeout as sleep } from 'node:timers/promises';
import { inProcess } from '../src/in-process/index.ts';
import { messaging } from '../src/index.ts';
import { handlersOf, ordersContract } from './orders.ts';

/**
 * Runs the messaging of Orders over `inProcess()` with a Handler that fails its Command, whose redelivery
 * is due in an hour: it writes `failed` to stdout once the redelivery is waiting, closes the messaging when it
 * is given `closed`, and returns, so its process ends on its own only if nothing of the Broker's is left running.
 */
const [mode] = process.argv.slice(2);
if (mode !== 'closed' && mode !== 'open') {
  throw new Error('usage: in-process-exit.ts closed|open');
}

const faulted = Promise.withResolvers<void>();
const orders = await messaging(
  ordersContract,
  inProcess({ durableConsumerDefaults: { ackWait: '1h', maxDeliver: 3 } }),
  { onServiceFault: () => void faulted.resolve() },
);
const failing = () => {
  throw new Error('the Handler failed');
};
await orders.consume(handlersOf([], { charge: failing }), {});
await orders.sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
await faulted.promise;
await sleep(100);

process.stdout.write('failed\n');
if (mode === 'closed') {
  await orders.close();
}
