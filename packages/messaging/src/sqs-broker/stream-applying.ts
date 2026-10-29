// biome-ignore-all lint/style/useNamingConvention: SNS spells its fields in PascalCase
import { CreateTopicCommand, type SNSClient } from '@aws-sdk/client-sns';
import { type Applied, refusedBy } from './applied.ts';

/** Creates the Service's own topic, or finds the one that exists: SNS answers a name it holds with its ARN, and no attribute is sent, so none differs. */
export async function applyStream(sns: SNSClient, name: string): Promise<Applied> {
  try {
    await sns.send(new CreateTopicCommand({ Name: name }));
    return { kind: 'applied' };
  } catch (error) {
    return refusedBy(`The stream ${name}`, error);
  }
}
