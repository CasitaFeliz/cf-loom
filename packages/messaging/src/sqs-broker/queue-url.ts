// biome-ignore-all lint/style/useNamingConvention: SQS spells its fields in PascalCase
import { GetQueueUrlCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { isAwsError } from './aws-errors.ts';

/** The URL of the queue named `name`, or `undefined` when SQS says it does not exist; any other answer is thrown. */
export async function queueUrlOf(sqs: SQSClient, name: string): Promise<string | undefined> {
  try {
    const found = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    return found.QueueUrl;
  } catch (error) {
    if (isAwsError(error, 'QueueDoesNotExist')) {
      return undefined;
    }
    throw error;
  }
}
