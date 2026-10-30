// biome-ignore-all lint/style/useNamingConvention: AWS names its settings in PascalCase
import { applyBrokerPlan, type SqsBrokerLimits, type SqsConnecting } from '@cf-loom/messaging/sqs';
import { planOf } from './broker-plan-of.ts';

/** Every setting of a test's plans on SNS/SQS, for one throwaway moto server. */
const testLimits: SqsBrokerLimits = {
  durableConsumerDefaults: {
    ackWait: '30s',
    deadLetterRetention: '2h',
    maxDeliver: 5,
    retention: '1h',
  },
};

/** Applies the plan of the Service in `serviceDir` to moto, as the organization's deploy step would. */
export async function applyPlanOf(
  serviceDir: string,
  connecting: SqsConnecting,
  prefix: string,
): Promise<void> {
  await applyBrokerPlan(connecting, planOf(serviceDir, prefix), testLimits);
}
