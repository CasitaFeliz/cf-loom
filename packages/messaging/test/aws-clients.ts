// biome-ignore-all lint/style/useNamingConvention: AWS names its fields in PascalCase, as they travel
import { ListTopicsCommand, SNSClient } from '@aws-sdk/client-sns';
import {
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
  ListQueueTagsCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
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

function lastSegmentOf(text: string, separator: string): string {
  return text.slice(text.lastIndexOf(separator) + 1);
}

/** The names of the topics that exist, sorted. */
export async function topicNamesOf(sns: SNSClient): Promise<string[]> {
  const listed = await sns.send(new ListTopicsCommand({}));
  const arns = (listed.Topics ?? []).map((topic) => topic.TopicArn ?? '');
  return arns.map((arn) => lastSegmentOf(arn, ':')).sort();
}

/** The names of the queues that exist, sorted. */
export async function queueNamesOf(sqs: SQSClient): Promise<string[]> {
  const listed = await sqs.send(new ListQueuesCommand({ MaxResults: 1000 }));
  return (listed.QueueUrls ?? []).map((url) => lastSegmentOf(url, '/')).sort();
}

/** The URL of the queue named `name`. */
async function queueUrlOf(sqs: SQSClient, name: string): Promise<string> {
  const found = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
  return found.QueueUrl ?? '';
}

/** Every attribute SQS holds for the queue named `name`. */
export async function queueAttributesOf(
  sqs: SQSClient,
  name: string,
): Promise<Record<string, string>> {
  const QueueUrl = await queueUrlOf(sqs, name);
  const read = await sqs.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['All'] }));
  return read.Attributes ?? {};
}

/** The tags of the queue named `name`. */
export async function queueTagsOf(sqs: SQSClient, name: string): Promise<Record<string, string>> {
  const QueueUrl = await queueUrlOf(sqs, name);
  const read = await sqs.send(new ListQueueTagsCommand({ QueueUrl }));
  return read.Tags ?? {};
}
