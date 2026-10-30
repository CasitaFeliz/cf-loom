import type { SNSClient } from '@aws-sdk/client-sns';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { partition } from '@aws-sdk/core/client';
import { oneLineOf } from '../broker-limits/index.ts';

/** How cf-loom reaches SNS and SQS: the organization's own clients, of one account and one region, which cf-loom never destroys. */
export type SqsConnecting = {
  /** Its region is the environment's, and every ARN cf-loom builds is in it, in the partition the AWS SDK gives that region. */
  readonly sns: SNSClient;
  /** Of the same account and region as `sns`. */
  readonly sqs: SQSClient;
  /** The 12-digit AWS account id the topics and queues are in. */
  readonly account: string;
};

/** Where an environment's topics and queues are, and so what every ARN cf-loom builds is made of: the partition and region of its clients, and its account. */
export type Place = {
  readonly partition: string;
  readonly region: string;
  readonly account: string;
};

/** The place of the clients, or the lines refusing what makes them no one place. */
export type Located =
  | { readonly kind: 'located'; readonly place: Place }
  | { readonly kind: 'refused'; readonly lines: readonly string[] };

/** The one place of the clients: their account and region, whose partition the AWS SDK knows; or a refusal of an account that is not 12 digits and of clients in two regions, before any call. */
export async function placeOf(connecting: SqsConnecting): Promise<Located> {
  const snsRegion = await connecting.sns.config.region();
  const sqsRegion = await connecting.sqs.config.region();
  const lines = [...accountLinesOf(connecting.account), ...regionLinesOf(snsRegion, sqsRegion)];
  if (lines.length > 0) {
    return { kind: 'refused', lines };
  }
  const place = {
    partition: partition(snsRegion).name,
    region: snsRegion,
    account: connecting.account,
  };
  return { kind: 'located', place };
}

/** An ARN AWS answered, and the call that answered it. */
export type AnsweredArn = { readonly from: string; readonly arn: string };

/** Refuses an ARN AWS answered otherwise than the one built, naming both, and the other account when the account part differs, as a wrong `connecting.account` makes it. */
export function confirmArn(answered: AnsweredArn, built: string): void {
  if (answered.arn === built) {
    return;
  }
  const given = `${answered.from} gave ${answered.arn}, not ${built}`;
  const [builtAccount, givenAccount] = [accountOf(built), accountOf(answered.arn)];
  const why =
    givenAccount === builtAccount
      ? 'check the region of the clients'
      : `${givenAccount} is another account than connecting.account ${builtAccount}`;
  throw new Error(`${given}: ${why}`);
}

/** The account part of an ARN, whose name part holds no `:`. */
function accountOf(arn: string): string | undefined {
  return arn.split(':')[4];
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
    : [`connecting.account ${oneLineOf(account)} is not a 12-digit AWS account id`];
}

function regionLinesOf(snsRegion: string, sqsRegion: string): readonly string[] {
  return snsRegion === sqsRegion
    ? []
    : [
        `connecting.sns is in the region ${snsRegion} and connecting.sqs in ${sqsRegion}: they must be in one region`,
      ];
}
