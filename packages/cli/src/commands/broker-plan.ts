import { type BrokerPlan, brokerPlanOf } from '@cf-loom/contract/internal';
import { builtOf, type Run } from '../project/index.ts';
import {
  committedStopOf,
  done,
  type Exit,
  failureExitOf,
  type Stopped,
  toolingError,
} from './exit.ts';

/** The broker plan of a Service, with its name for the line that says the plan is empty. */
type Planned = { readonly kind: 'planned'; readonly service: string; readonly plan: BrokerPlan };

/**
 * Prints the broker plan of a Service from the committed Snapshot, which must be what `generate`
 * would write; an Application or a Definitions Package has none.
 */
export async function brokerPlanCommand(run: Run, prefix: string | null): Promise<Exit> {
  const planned = await plannedOf(run, prefix);
  if (planned.kind === 'stopped') {
    return planned.exit;
  }
  return done(brokerPlanLinesOf(planned.plan, planned.service), { plan: planned.plan });
}

async function plannedOf(run: Run, prefix: string | null): Promise<Planned | Stopped> {
  const built = await builtOf(run, 'committed');
  if (built.kind !== 'built') {
    return { kind: 'stopped', exit: failureExitOf(built) };
  }
  const { snapshot } = built;
  switch (snapshot.kind) {
    case 'application':
      return { kind: 'stopped', exit: toolingError(noPlanLine('An Application')) };
    case 'definitions':
      return { kind: 'stopped', exit: toolingError(noPlanLine('A Definitions Package')) };
    case 'service': {
      const stop = committedStopOf(built);
      if (stop !== undefined) {
        return { kind: 'stopped', exit: stop };
      }
      return { kind: 'planned', service: snapshot.name, plan: brokerPlanOf(snapshot, prefix) };
    }
  }
}

function noPlanLine(root: string): string {
  return `${root} has no broker plan: only a Service's Messages travel through the Broker`;
}

/** The lines `broker-plan` prints: each stream with its subjects, then each durable consumer, or that the Service needs none. */
function brokerPlanLinesOf(plan: BrokerPlan, service: string): readonly string[] {
  const streams = Object.entries(plan.streams).map(
    ([name, stream]) => `Stream ${name}: ${stream.subjects.join(' ')}`,
  );
  const consumers = Object.entries(plan.consumers).map(
    ([name, consumer]) => `Durable consumer ${name} on ${consumer.stream}: ${consumer.subject}`,
  );
  const lines = [...streams, ...consumers];
  return lines.length === 0 ? [`${service} needs no stream and no durable consumer`] : lines;
}
