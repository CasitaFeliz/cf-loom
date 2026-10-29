import type { BrokerPlan, Closed } from '@cf-loom/contract/internal';
import { type DefaultsFields, plannedOf } from '../broker-limits/index.ts';
import type { Applied } from './applied.ts';
import { type Place, placeOf, type SqsConnecting } from './connecting.ts';
import { applyDurableConsumer } from './durable-consumer-applying.ts';
import type { SqsBrokerLimits } from './limits.ts';
import { durableConsumerLimits, type PlannedQueue } from './reading-limits.ts';
import { applyStream } from './stream-applying.ts';

/** Applies a Service's Broker plan on SNS/SQS under the Broker prefix the plan names; the organization calls it, `messaging()` never does. */
export async function applyBrokerPlan<const Given = unknown, const GivenLimits = unknown>(
  connecting: Closed<Given, SqsConnecting>,
  plan: BrokerPlan,
  limits: Closed<GivenLimits, SqsBrokerLimits & DefaultsFields<GivenLimits, SqsBrokerLimits>>,
): Promise<void> {
  const planned = plannedOf(plan, limits, {
    definer: 'SqsBrokerLimits',
    durableConsumer: durableConsumerLimits,
  });
  if (planned.kind === 'refused') {
    throw new Error(planned.message);
  }
  const place = await placeOf(connecting);
  const applied = await applyAll(connecting, place, planned);
  if (applied.kind === 'refused') {
    throw new Error(applied.message, { cause: applied.cause });
  }
}

type ToApply = {
  readonly plan: BrokerPlan;
  readonly durableConsumers: readonly PlannedQueue[];
};

async function applyAll(
  connecting: SqsConnecting,
  place: Place,
  { plan, durableConsumers }: ToApply,
): Promise<Applied> {
  for (const name of Object.keys(plan.streams)) {
    const applied = await applyStream(connecting.sns, name);
    if (applied.kind === 'refused') {
      return applied;
    }
  }
  for (const planned of durableConsumers) {
    const applied = await applyDurableConsumer(connecting, place, planned);
    if (applied.kind === 'refused') {
      return applied;
    }
  }
  return { kind: 'applied' };
}
