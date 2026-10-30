import type { Closed } from '@cf-loom/contract/internal';
import type { Broker, BrokerPrefixed } from '../broker/index.ts';
import type { SqsConnecting } from './connecting.ts';
import { sqsConnectionOf } from './sqs-connection.ts';

/** What `sqs()` takes: how cf-loom reaches SNS and SQS, and the Broker prefix of every name it uses on the Broker. */
export type SqsBrokerOptions = SqsConnecting & BrokerPrefixed;

/** A Broker on SNS/SQS: each `messaging()` starts only once the Service's SNS topic exists, and `consume` receives from each Durable consumer's SQS queue, through the organization's clients, which cf-loom never destroys. */
export function sqs<const Given = unknown>(_options: Closed<Given, SqsBrokerOptions>): Broker {
  return { connect: () => Promise.resolve(sqsConnectionOf()) };
}
