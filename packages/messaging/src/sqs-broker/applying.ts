import type { BrokerPlan, Closed } from '@cf-loom/contract/internal';
import { applyInOrder, throwIfRefused } from '../broker-applying/index.ts';
import { type DefaultsFields, plannedOf } from '../broker-limits/index.ts';
import { accountLinesOf, placeOf, type SqsConnecting } from './connecting.ts';
import { type Applier, applyDurableConsumer } from './durable-consumer-applying.ts';
import type { SqsBrokerLimits } from './limits.ts';
import { durableConsumerLimits } from './reading-limits.ts';
import { applyStream } from './stream-applying.ts';
import { subscribingOn } from './subscribing.ts';

/** Applies a Service's Broker plan on SNS/SQS under the Broker prefix the plan names; the organization calls it, `messaging()` never does. */
export async function applyBrokerPlan<const Given = unknown, const GivenLimits = unknown>(
  connecting: Closed<Given, SqsConnecting>,
  plan: BrokerPlan,
  limits: Closed<GivenLimits, SqsBrokerLimits & DefaultsFields<GivenLimits, SqsBrokerLimits>>,
): Promise<void> {
  const checked = checkedOf(connecting.account, plan, limits);
  if (checked.kind === 'refused') {
    throw new Error(checked.message);
  }
  const { sns, sqs } = connecting;
  const applier: Applier = {
    sns,
    sqs,
    place: await placeOf(connecting),
    subscribing: subscribingOn(sns),
  };
  const streams = Object.keys(checked.plan.streams);
  throwIfRefused(
    await applyInOrder(
      { streams, durableConsumers: checked.durableConsumers },
      {
        stream: (name) => applyStream(sns, name),
        durableConsumer: (planned) => applyDurableConsumer(applier, planned),
      },
    ),
  );
}

/** The plan and limits read, or one message with a line for each place they or the account break their shape. */
function checkedOf(account: unknown, plan: unknown, limits: unknown) {
  const planned = plannedOf(plan, limits, {
    definer: 'SqsBrokerLimits',
    durableConsumer: durableConsumerLimits,
  });
  const lines = accountLinesOf(account);
  if (planned.kind === 'refused') {
    return { kind: 'refused' as const, message: [...lines, planned.message].join('\n') };
  }
  return lines.length === 0 ? planned : { kind: 'refused' as const, message: lines.join('\n') };
}
