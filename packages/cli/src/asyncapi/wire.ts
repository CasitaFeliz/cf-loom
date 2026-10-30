/** The Brokers whose wire an AsyncAPI document can describe: the JetStream adapter's and the SNS/SQS adapter's. */
export type AsyncApiBroker = 'jetstream' | 'sqs';

/** Whether a text names a Broker whose wire an AsyncAPI document can describe. */
export function isAsyncApiBroker(text: string): text is AsyncApiBroker {
  return text === 'jetstream' || text === 'sqs';
}

/** The wire an AsyncAPI document describes: the Broker, and the prefix in front of its subjects and names, if one is given. */
export type AsyncApiWire = {
  readonly broker: AsyncApiBroker;
  readonly prefix: string | null;
};
