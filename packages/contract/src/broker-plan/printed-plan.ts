import type { Problem } from '../validation/index.ts';
import type { Path } from '../walker/index.ts';
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
  return streamDifferenceOf(plan, printed, service) ?? consumerDifferenceOf(plan, printed, service);
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

function streamDifferenceOf(
  plan: BrokerPlan,
  printed: BrokerPlan,
  service: string,
): Problem | undefined {
  const names = listDifferenceOf(Object.keys(plan.streams), Object.keys(printed.streams), {
    service,
    at: ['streams'],
    placeOf: (_, name) => ['streams', name],
  });
  if (names !== undefined) {
    return names;
  }
  for (const [name, stream] of Object.entries(plan.streams)) {
    const expected = printed.streams[name];
    if (stream.service !== expected?.service) {
      return unprintedAt(['streams', name, 'service'], service);
    }
    const subjects = listDifferenceOf(stream.subjects, expected?.subjects ?? [], {
      service,
      at: ['streams', name, 'subjects'],
      placeOf: (index) => ['streams', name, 'subjects', index],
    });
    if (subjects !== undefined) {
      return subjects;
    }
  }
  return undefined;
}

const consumerFields = ['service', 'stream', 'subject'] as const;

function consumerDifferenceOf(
  plan: BrokerPlan,
  printed: BrokerPlan,
  service: string,
): Problem | undefined {
  const names = listDifferenceOf(
    Object.keys(plan.durableConsumers),
    Object.keys(printed.durableConsumers),
    { service, at: ['durableConsumers'], placeOf: (_, name) => ['durableConsumers', name] },
  );
  if (names !== undefined) {
    return names;
  }
  for (const [name, consumer] of Object.entries(plan.durableConsumers)) {
    const expected = printed.durableConsumers[name];
    const field = consumerFields.find((key) => expected?.[key] !== consumer[key]);
    if (field !== undefined) {
      return unprintedAt(['durableConsumers', name, field], service);
    }
  }
  return undefined;
}

/** Where a list of the plan sits, the place of one of its items and the Service whose plan it is compared with. */
type Comparison = {
  readonly service: string;
  readonly at: Path;
  readonly placeOf: (index: number, item: string) => Path;
};

/** An item the printed list does not hold, then one it holds that the given list lacks. */
function listDifferenceOf(
  given: readonly string[],
  printed: readonly string[],
  where: Comparison,
): Problem | undefined {
  const printedItems = new Set(printed);
  for (const [index, item] of given.entries()) {
    if (!printedItems.has(item)) {
      return unprintedAt(where.placeOf(index, item), where.service);
    }
  }
  const givenItems = new Set(given);
  const lacking = printed.find((item) => !givenItems.has(item));
  if (lacking !== undefined) {
    return {
      at: where.at,
      reason: `lacks ${lacking}, which the plan's names print for ${where.service}`,
    };
  }
  return undefined;
}

function unprintedAt(at: Path, service: string): Problem {
  return { at, reason: `is not what the plan's names print for ${service}` };
}
