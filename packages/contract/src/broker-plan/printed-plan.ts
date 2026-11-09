import type { Problem } from '../validation/index.ts';
import type { RoutedSubscription } from '../wire/index.ts';
import { type BrokerPlan, brokerPlanOfRoutes, type RoutedService } from './broker-plan.ts';
import type { ReadPlan } from './read-plan.ts';

/** The first place a plan differs from the one its own parts print for the Service it names first. */
export function unprintedProblemOf(plan: BrokerPlan, read: ReadPlan): Problem | undefined {
  const service = read.streams[0]?.service ?? read.consumers[0]?.service;
  if (service === undefined) {
    return undefined;
  }
  const printed = brokerPlanOfRoutes(routedOf(service, read), plan.prefix);
  return differenceOf(plan, printed, service);
}

/** The Message Versions of the Service's own Stream and the Subscriptions the Durable consumers are. */
function routedOf(service: string, read: ReadPlan): RoutedService {
  const subjects = read.streams.flatMap((stream) => stream.subjects);
  const subscriptions: RoutedSubscription[] = [];
  for (const { consumed, subject } of read.consumers) {
    if (consumed.kind === 'subscription') {
      subscriptions.push({ name: consumed.name, provider: subject.service, event: subject });
    }
  }
  return {
    service,
    messages: subjects.filter((subject) => subject.service === service),
    subscriptions,
  };
}

const consumerFields = ['service', 'stream', 'subject'] as const;

const listings = ['streams', 'durableConsumers'] as const;

function differenceOf(plan: BrokerPlan, printed: BrokerPlan, service: string): Problem | undefined {
  for (const listing of listings) {
    const extra = Object.keys(plan[listing]).find((name) => !Object.hasOwn(printed[listing], name));
    if (extra !== undefined) {
      return { at: [listing, extra], reason: unprinted(service) };
    }
  }
  return consumerDifferenceOf(plan, printed, service);
}

function consumerDifferenceOf(
  plan: BrokerPlan,
  printed: BrokerPlan,
  service: string,
): Problem | undefined {
  for (const [name, consumer] of Object.entries(plan.durableConsumers)) {
    const expected = printed.durableConsumers[name];
    const field = consumerFields.find((key) => expected?.[key] !== consumer[key]);
    if (field !== undefined) {
      return { at: ['durableConsumers', name, field], reason: unprinted(service) };
    }
  }
  return undefined;
}

function unprinted(service: string): string {
  return `is not what the plan's names print for ${service}`;
}
