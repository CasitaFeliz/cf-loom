import { type BrokerPlan, brokerPlanOf } from '@cf-loom/contract/internal';
import { committedServiceOf } from './document.ts';
import { done, type Exit } from './exit.ts';
import type { Run } from './run.ts';

/**
 * Prints the broker plan of a Service from the committed Snapshot, which must be what `generate`
 * would write; an Application or a Definitions Package has none.
 */
export async function brokerPlanCommand(run: Run, prefix: string | null): Promise<Exit> {
  const committed = await committedServiceOf(run, noPlanLine);
  if (committed.kind === 'stopped') {
    return committed.exit;
  }
  const plan = brokerPlanOf(committed.snapshot, prefix);
  return done(brokerPlanLinesOf(plan, committed.snapshot.name), { plan });
}

function noPlanLine(root: string): string {
  return `${root} has no Broker plan: only a Service's Messages travel through the Broker`;
}

/** The lines `broker-plan` prints: each stream with its subjects, then each Durable consumer, or that the Service needs none. */
function brokerPlanLinesOf(plan: BrokerPlan, service: string): readonly string[] {
  const streams = Object.entries(plan.streams).map(
    ([name, stream]) => `Stream ${name}: ${stream.subjects.join(' ')}`,
  );
  const durableConsumers = Object.entries(plan.durableConsumers).map(
    ([name, durableConsumer]) =>
      `Durable consumer ${name} on ${durableConsumer.stream}: ${durableConsumer.subject}`,
  );
  const lines = [...streams, ...durableConsumers];
  return lines.length === 0 ? [`${service} needs no stream and no Durable consumer`] : lines;
}
