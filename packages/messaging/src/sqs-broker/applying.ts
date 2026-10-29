import type { BrokerPlan, Closed } from '@cf-loom/contract/internal';
import { applyInOrder, throwIfRefused } from '../broker-applying/index.ts';
import { type DefaultsFields, plannedOf } from '../broker-limits/index.ts';
import { type Place, placeOf, type SqsConnecting, topicArnOf } from './connecting.ts';
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
  const checked = await checkedOf(connecting, plan, limits);
  if (checked.kind === 'refused') {
    throw new Error(checked.message);
  }
  const { sns, sqs } = connecting;
  const { place } = checked;
  const applier: Applier = { sns, sqs, place, subscribing: subscribingOn(sns) };
  const streams = Object.keys(checked.plan.streams).map((name) => streamToApplyOf(place, name));
  throwIfRefused(
    await applyInOrder(
      { streams, durableConsumers: checked.durableConsumers },
      {
        stream: (stream) => applyStream(sns, stream),
        durableConsumer: (planned) => applyDurableConsumer(applier, planned),
      },
    ),
  );
}

function streamToApplyOf(place: Place, name: string) {
  return { name, arn: topicArnOf(place, name) };
}

/** The place of the clients, the plan and the limits read, or one message with a line for each place they break their shape. */
async function checkedOf(connecting: SqsConnecting, plan: unknown, limits: unknown) {
  const located = await placeOf(connecting);
  const planned = plannedOf(plan, limits, {
    definer: 'SqsBrokerLimits',
    durableConsumer: durableConsumerLimits,
  });
  if (located.kind === 'located' && planned.kind === 'planned') {
    return { ...planned, place: located.place };
  }
  const locating = located.kind === 'refused' ? located.lines : [];
  const planning = planned.kind === 'refused' ? [planned.message] : [];
  return { kind: 'refused' as const, message: [...locating, ...planning].join('\n') };
}
