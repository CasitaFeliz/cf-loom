import { inspect } from 'node:util';
import type { SNSClient } from '@aws-sdk/client-sns';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { partition } from '@aws-sdk/core/client';

/** How cf-loom reaches SNS and SQS: the organization's own clients, of one account and one region, which cf-loom never destroys. */
export type SqsConnecting = {
  /** Its region is the environment's: every topic ARN cf-loom builds is in it, in the partition the AWS SDK gives that region. */
  readonly sns: SNSClient;
  /** Of the same account as `sns`; the queue ARNs cf-loom builds are in its region and partition, which need not be `sns`'s. */
  readonly sqs: SQSClient;
  /** The 12-digit AWS account id the topics and queues are in. */
  readonly account: string;
};

/** Where an environment's topics and queues are: the partition and region of its clients, and its account. */
export type Place = {
  readonly partition: string;
  readonly region: string;
  readonly account: string;
};

/** A client of the AWS SDK, which knows the region it is in. */
type RegionalClient = { readonly config: { readonly region: () => Promise<string> } };

/** The place of a client's region, whose partition the AWS SDK knows. */
export async function placeOf(client: RegionalClient, account: string): Promise<Place> {
  const region = await client.config.region();
  return { partition: partition(region).name, region, account };
}

/** The ARN of the SQS queue named `name` in the place. */
export function queueArnOf(place: Place, name: string): string {
  return `arn:${place.partition}:sqs:${place.region}:${place.account}:${name}`;
}

/** The ARN of the SNS topic named `name` in the place. */
export function topicArnOf(place: Place, name: string): string {
  return `arn:${place.partition}:sns:${place.region}:${place.account}:${name}`;
}

/** The lines refusing an account that is not 12 digits, which only untyped code can pass; whether it is the clients' own is AWS's to answer. */
export function accountLinesOf(account: unknown): readonly string[] {
  const isAccount = typeof account === 'string' && /^\d{12}$/.test(account);
  return isAccount
    ? []
    : [`connecting.account ${inspect(account)} is not a 12-digit AWS account id`];
}
