import { type BrokerPlan, type Closed, linesTextOf } from '@cf-loom/contract/internal';
import type { JetStreamManager } from '@nats-io/jetstream';
import { type Applied, applyInOrder, throwIfRefused } from '../broker-applying/index.ts';
import type { DefaultsFields } from '../broker-limits/index.ts';
import { drainOrClose, unansweredDrainError } from './connection.ts';
import { applyDurableConsumer } from './durable-consumer-applying.ts';
import type { JetStreamConnecting } from './jetstream.ts';
import type { JetStreamBrokerLimits } from './limits.ts';
import { checkedOf, type ResolvedPlan } from './settings.ts';
import { applyStream } from './stream-applying.ts';
import { managerOf } from './stream-check.ts';

/** Applies a Service's broker plan under the Broker prefix the plan names; the organization calls it, `messaging()` never does. */
export async function applyBrokerPlan<const Given = unknown, const GivenLimits = unknown>(
  connecting: Closed<Given, JetStreamConnecting>,
  plan: BrokerPlan,
  limits: Closed<
    GivenLimits,
    JetStreamBrokerLimits & DefaultsFields<GivenLimits, JetStreamBrokerLimits>
  >,
): Promise<void> {
  const checked = checkedOf(plan, limits);
  if (checked.kind === 'refused') {
    throw new Error(linesTextOf(checked.lines));
  }
  throwIfRefused(await appliedOn(connecting, checked));
}

async function appliedOn(
  connecting: JetStreamConnecting,
  settings: ResolvedPlan,
): Promise<Applied> {
  const natsConnection = await connecting.connect();
  const applying = managerOf(natsConnection, connecting.jetstream).then((manager) =>
    applyAll(manager, settings),
  );
  const [applied] = await Promise.allSettled([applying]);
  const ended = await drainOrClose(natsConnection);
  if (applied.status === 'rejected') {
    throw applied.reason;
  }
  if (applied.value.kind === 'applied' && ended.kind === 'unanswered') {
    throw unansweredDrainError(ended.cause);
  }
  return applied.value;
}

function applyAll(manager: JetStreamManager, settings: ResolvedPlan): Promise<Applied> {
  return applyInOrder(settings, {
    stream: (stream) => applyStream(manager, stream),
    durableConsumer: (planned) => applyDurableConsumer(manager, planned),
  });
}
