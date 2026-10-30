import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

/** The account moto holds topics and queues under unless a test says another. */
export const motoAccount = '123456789012';

/** The region a test's clients are in unless it says another. */
export const testRegion = 'eu-west-1';

/** Where a test's clients reach moto from, each part defaulting to the usual one. */
export type MotoPlace = {
  readonly region?: string;
  readonly sqsRegion?: string;
  readonly account?: string;
  readonly sqsUrl?: string;
};

/** SNS and SQS clients pointed at a moto server with dummy credentials and no retries, so a failing call fails at once; the caller destroys them. */
export function motoClientsAt(
  url: string,
  place: MotoPlace = {},
): { readonly sns: SNSClient; readonly sqs: SQSClient; readonly account: string } {
  const settings = {
    region: place.region ?? testRegion,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
  };
  const sns = new SNSClient({ ...settings, endpoint: url });
  const sqs = new SQSClient({
    ...settings,
    region: place.sqsRegion ?? settings.region,
    endpoint: place.sqsUrl ?? url,
  });
  return { sns, sqs, account: place.account ?? motoAccount };
}
