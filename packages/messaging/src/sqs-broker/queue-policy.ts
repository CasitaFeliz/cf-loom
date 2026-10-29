// biome-ignore-all lint/style/useNamingConvention: IAM spells its policy fields in PascalCase
import { z } from 'zod';

const topicStatementId = 'cf-loom-topic';

const topicStatement = z.object({ Sid: z.literal(topicStatementId) });

const policyDocument = z.looseObject({
  Statement: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
});

/** Who may send to a queue: the topic its Durable consumer's Stream is. */
export type TopicSender = { readonly queueArn: string; readonly topicArn: string };

/** The queue's policy with the Stream's topic allowed to send to it, in the statement `cf-loom-topic`: added to the policy the queue holds, or replacing the one cf-loom wrote, with every other statement kept. */
export function queuePolicyWith(held: string | undefined, sender: TopicSender): string {
  const document = policyDocument.parse(held === undefined ? {} : JSON.parse(held));
  const statements = statementsOf(document.Statement);
  const written = topicStatementOf(sender);
  const at = statements.findIndex(isTopicStatement);
  const replaced = at === -1 ? [...statements, written] : statements.with(at, written);
  return JSON.stringify({ Version: '2012-10-17', ...document, Statement: replaced });
}

/** The statements of a policy, which IAM allows as one object as well as a list. */
function statementsOf(statement: unknown): readonly unknown[] {
  if (statement === undefined) {
    return [];
  }
  return Array.isArray(statement) ? statement : [statement];
}

function isTopicStatement(statement: unknown): boolean {
  return topicStatement.safeParse(statement).success;
}

function topicStatementOf({ queueArn, topicArn }: TopicSender) {
  return {
    Sid: topicStatementId,
    Effect: 'Allow',
    Principal: { Service: 'sns.amazonaws.com' },
    Action: 'sqs:SendMessage',
    Resource: queueArn,
    Condition: { ArnEquals: { 'aws:SourceArn': topicArn } },
  };
}
