// biome-ignore-all lint/style/useNamingConvention: SNS spells its fields in PascalCase
import { GetTopicAttributesCommand, type SNSClient } from '@aws-sdk/client-sns';
import { isAwsError } from './aws-errors.ts';

/** Whether SNS holds the topic with this ARN; any answer but "not found" is thrown. */
export async function isTopic(sns: SNSClient, topicArn: string): Promise<boolean> {
  try {
    await sns.send(new GetTopicAttributesCommand({ TopicArn: topicArn }));
    return true;
  } catch (error) {
    if (isAwsError(error, 'NotFoundException')) {
      return false;
    }
    throw error;
  }
}
