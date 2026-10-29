// biome-ignore-all lint/style/useNamingConvention: AWS names its fields in PascalCase, as they travel
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { onTestFinished } from 'vitest';
import type { SqsConnecting } from '../src/sqs/index.ts';

/** The account moto holds topics and queues under unless a test says another. */
export const motoAccount = '123456789012';

/** The region a test's clients are in unless it says another. */
export const testRegion = 'eu-west-1';

/** SNS and SQS clients pointed at a moto server with dummy credentials and no retries, so a failing call fails at once; destroyed when the test ends. */
export function anAwsConnecting(
  url: string,
  place: { readonly region?: string; readonly account?: string } = {},
): SqsConnecting {
  const settings = {
    endpoint: url,
    region: place.region ?? testRegion,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
  };
  const sns = new SNSClient(settings);
  const sqs = new SQSClient(settings);
  onTestFinished(() => {
    sns.destroy();
    sqs.destroy();
  });
  return { sns, sqs, account: place.account ?? motoAccount };
}

/** Counts the commands of one kind a client sends from now on, such as `SetSubscriptionAttributesCommand`. */
export function countCommands(client: SNSClient, commandName: string) {
  let sent = 0;
  client.middlewareStack.add(
    (next, context) => (args) => {
      sent += context.commandName === commandName ? 1 : 0;
      return next(args);
    },
    { step: 'initialize', name: `count-${commandName}` },
  );
  return { sent: () => sent };
}
