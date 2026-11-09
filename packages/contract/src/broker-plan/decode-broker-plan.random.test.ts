import { describe, expect, test } from 'vitest';
import { brokerPlanOfModel, type ServiceModel } from '../../test/broker-plans.ts';
import { drawnModel, drawnPrefix, longestName } from '../../test/random-broker-plans.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { type BrokerPlan, decodeBrokerPlan } from '../internal/index.ts';

/** A Service a draw declared, with the prefix it is printed under and the plan `cf-loom broker-plan` prints. */
type Printed = {
  readonly model: ServiceModel;
  readonly prefix: string | null;
  readonly plan: BrokerPlan;
};

const draws = 600;

/** The plans of the Services that a seeded draw declares and `generate` accepts, how many it refused, and the plans as JSON gives them back. */
function printedPlansOf(seed: number) {
  const next = seededNext(seed);
  const printed: Printed[] = [];
  let refused = 0;
  for (let draw = 0; draw < draws; draw += 1) {
    const model = drawnModel(next);
    const prefix = drawnPrefix(next);
    const plan = brokerPlanOfModel(model, prefix);
    if (plan === undefined) {
      refused += 1;
    } else {
      printed.push({ model, prefix, plan });
    }
  }
  return { printed, refused };
}

const { printed, refused } = printedPlansOf(5160);

describe('the plans cf-loom broker-plan prints', () => {
  test('the Services drawn hold every case the decoder acts on, and the longest names', () => {
    const plans = printed.map(({ plan }) => plan);
    const consumers = plans.flatMap(({ durableConsumers }) => Object.entries(durableConsumers));
    const ownStream = (consumer: { service: string; stream: string }) =>
      consumer.stream.endsWith(consumer.service);

    const cases = {
      noStream: plans.some(({ streams }) => Object.keys(streams).length === 0),
      aStream: plans.some(({ streams }) => Object.keys(streams).length === 1),
      commandConsumer: consumers.some(([name]) => name.includes('_command_')),
      ownEventConsumer: consumers.some(
        ([name, consumer]) => !name.includes('_command_') && ownStream(consumer),
      ),
      providerEventConsumer: consumers.some(
        ([name, consumer]) => !name.includes('_command_') && !ownStream(consumer),
      ),
      noPrefix: plans.some(({ prefix }) => prefix === null),
      aPrefix: plans.some(({ prefix }) => prefix !== null),
      longestService: printed.some(({ model }) => model.service.length === longestName),
      longestPrefix: printed.some(({ prefix }) => prefix?.length === longestName),
      longestMessage: printed.some(({ model }) =>
        [...model.events, ...model.commands].some(({ name }) => name.length === longestName),
      ),
      longestSubscription: printed.some(({ model }) =>
        model.subscriptions.some(({ name }) => name.length === longestName),
      ),
      aLargeVersion: printed.some(({ model }) =>
        [...model.events, ...model.commands].some(({ version }) => version > 2 ** 32),
      ),
    };

    expect(Object.entries(cases).filter(([, held]) => !held)).toEqual([]);
    expect(refused).toBeLessThan(draws / 10);
  });

  test('parsed back from JSON, every one decodes to itself', () => {
    const undecoded = printed
      .map(({ plan }) => ({ plan, decoded: decodeBrokerPlan(JSON.parse(JSON.stringify(plan))) }))
      .filter(
        ({ plan, decoded }) =>
          decoded.kind !== 'decoded' || JSON.stringify(decoded.plan) !== JSON.stringify(plan),
      );

    expect(undecoded.map(({ decoded }) => decoded)).toEqual([]);
  });
});
