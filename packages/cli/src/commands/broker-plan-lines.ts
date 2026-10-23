import type { BrokerPlan } from '@cf-loom/contract/internal';

/** The lines `broker-plan` prints: each stream with its subjects, then each durable consumer, or that the Service needs none. */
export function brokerPlanLinesOf(plan: BrokerPlan, service: string): readonly string[] {
  const streams = Object.entries(plan.streams).map(
    ([name, stream]) => `Stream ${name}: ${stream.subjects.join(' ')}`,
  );
  const consumers = Object.entries(plan.consumers).map(
    ([name, consumer]) => `Durable consumer ${name} on ${consumer.stream}: ${consumer.subject}`,
  );
  const lines = [...streams, ...consumers];
  return lines.length === 0 ? [`${service} needs no stream and no durable consumer`] : lines;
}
