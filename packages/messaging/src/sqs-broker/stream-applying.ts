// biome-ignore-all lint/style/useNamingConvention: SNS spells its fields in PascalCase
import { CreateTopicCommand, type SNSClient } from '@aws-sdk/client-sns';
import { type Applied, refusedBy } from '../broker-applying/index.ts';
import { answeredWith } from './aws-errors.ts';
import { confirmArn } from './connecting.ts';

/** A Stream of the plan: the name of its topic, and the ARN that name has in the place of the clients. */
export type StreamToApply = { readonly name: string; readonly arn: string };

/** Creates the Service's own topic, or finds the one that exists: SNS answers a name it holds with its ARN, and no attribute is sent, so none differs. The ARN it answers must be the one built, which a wrong account or region is not. */
export async function applyStream(sns: SNSClient, stream: StreamToApply): Promise<Applied> {
  try {
    const created = await sns.send(new CreateTopicCommand({ Name: stream.name }));
    const arn = answeredWith(created.TopicArn, 'TopicArn');
    confirmArn({ from: 'CreateTopic', arn }, stream.arn);
    return { kind: 'applied' };
  } catch (error) {
    return refusedBy(`The stream ${stream.name}`, error);
  }
}
