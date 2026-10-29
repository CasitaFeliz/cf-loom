import type { BrokerPlan, Closed } from '@cf-loom/contract/internal';
import type { JetStreamManager } from '@nats-io/jetstream';
import type { DefaultsFields } from '../broker-limits/index.ts';
import type { Applied } from './applied.ts';
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
    throw new Error(checked.message);
  }
  const applied = await appliedOn(connecting, checked);
  if (applied.kind === 'refused') {
    throw new Error(applied.message, { cause: applied.cause });
  }
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

async function applyAll(manager: JetStreamManager, settings: ResolvedPlan): Promise<Applied> {
  for (const stream of settings.streams) {
    const applied = await applyStream(manager, stream);
    if (applied.kind === 'refused') {
      return applied;
    }
  }
  for (const planned of settings.durableConsumers) {
    const applied = await applyDurableConsumer(manager, planned);
    if (applied.kind === 'refused') {
      return applied;
    }
  }
  return { kind: 'applied' };
}
