import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { messaging } from '../src/index.ts';
import { sqs } from '../src/sqs/index.ts';
import { handlersOf, ordersContract } from './orders.ts';

/**
 * Runs the messaging of Orders over `sqs()` against the moto server at the URL it is given, under the prefix it is
 * given: it consumes one Message, writes `closing` to stdout as it calls `close()`, closes, destroys its clients as
 * the organization would, and returns, so its process ends on its own only if nothing of the adapter's is left running.
 */
const [url, prefix] = process.argv.slice(2);
if (url === undefined || prefix === undefined) {
  throw new Error('usage: sqs-closing-fixture.ts <moto url> <prefix>');
}
const settings = {
  region: 'eu-west-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  maxAttempts: 1,
  endpoint: url,
};
const sns = new SNSClient(settings);
const sqsClient = new SQSClient(settings);

const orders = await messaging(
  ordersContract,
  sqs({ sns, sqs: sqsClient, account: '123456789012', prefix }),
);
const handled = Promise.withResolvers<void>();
await orders.consume(handlersOf([], { notify: () => void handled.resolve() }), {});
await handled.promise;

process.stdout.write('closing\n');
await orders.close();
sns.destroy();
sqsClient.destroy();
