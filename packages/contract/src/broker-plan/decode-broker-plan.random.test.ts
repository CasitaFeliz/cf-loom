import { describe, expect, test } from 'vitest';
import {
  dottedOf,
  type Mutated,
  mutatedOf,
  partReplacedOf,
  pick,
  placeOf,
  subjectSitesOf,
  type TextSite,
  textSitesOf,
  withoutEntry,
  withText,
} from '../../test/broker-plan-edits.ts';
import { brokerPlanOfModel, modelOfPlan, type ServiceModel } from '../../test/broker-plans.ts';
import { drawnModel, drawnPrefix, longestName } from '../../test/random-broker-plans.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { type BrokerPlan, decodeBrokerPlan } from '../internal/index.ts';

type Next = () => number;

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
    const declared = brokerPlanOfModel(model, prefix);
    if (declared.kind === 'refused') {
      refused += 1;
    } else {
      printed.push({ model, prefix, plan: declared.plan });
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

/** What the oracle says of a plan a decoder accepted: the Service its names declare prints the same plan, is refused only by a rule the plan leaves out, or is wrong. */
type Verdict = 'matches' | 'excluded' | 'unreadable' | 'invalid' | 'differs';

/** A Service declared from the names of a plan through the public API, which prints its plan again, compared with the plan. */
function verdictOf(decoded: BrokerPlan): Verdict {
  const model = modelOfPlan(decoded);
  if (model === undefined) {
    return 'unreadable';
  }
  const declared = brokerPlanOfModel(model, decoded.prefix);
  if (declared.kind === 'refused') {
    return declared.isOnlyByRulesThePlanLeavesOut ? 'excluded' : 'invalid';
  }
  return JSON.stringify(declared.plan) === JSON.stringify(decoded) ? 'matches' : 'differs';
}

/** What a plan with one site's text changed decodes to, judged: the kind of outcome it is, and why it is wrong when it is. */
type Judged = { readonly outcome: string; readonly failure?: unknown };

function judgedOf(json: unknown, site: TextSite, mutated: Mutated): Judged {
  const decoded = decodeBrokerPlan(withText(json, site, mutated.text));
  const at = dottedOf(placeOf(site, mutated.text));
  if (mutated.isUnprintable) {
    const isAtSite = decoded.kind === 'malformed' && decoded.reason.startsWith(`${at} `);
    return isAtSite
      ? { outcome: 'unprintable' }
      : { outcome: 'unprintable', failure: { at, decoded } };
  }
  if (decoded.kind === 'malformed') {
    return { outcome: 'refused' };
  }
  const verdict = verdictOf(decoded.plan);
  const isRight = verdict === 'matches' || verdict === 'excluded';
  return isRight
    ? { outcome: verdict }
    : { outcome: verdict, failure: { at, text: mutated.text, verdict } };
}

describe('a printed plan with one text changed', () => {
  test('is refused at that text when the change writes what no printer writes, and otherwise is refused or is the plan its names print', () => {
    const next = seededNext(5161);
    const judged: Judged[] = [];
    for (const { plan, prefix } of printed) {
      const json: unknown = JSON.parse(JSON.stringify(plan));
      const sites = textSitesOf(json);
      for (let attempt = 0; attempt < 32 && sites.length > 0; attempt += 1) {
        const site = pick(next, sites);
        const mutated = mutatedOf(next, site, prefix);
        if (mutated !== undefined) {
          judged.push(judgedOf(json, site, mutated));
        }
      }
    }
    const count = (outcome: string) => judged.filter((one) => one.outcome === outcome).length;

    expect(
      judged.filter(({ failure }) => failure !== undefined).map(({ failure }) => failure),
    ).toEqual([]);
    expect(count('unprintable')).toBeGreaterThan(300);
    expect(count('refused')).toBeGreaterThan(100);
    expect(count('matches')).toBeGreaterThan(40);
    expect(count('excluded')).toBeGreaterThan(0);
    expect(count('excluded')).toBeLessThan(judged.length / 20);
  });
});

/** One change to what a printed plan says, drawn from replacing a name a text is built from, swapping two subjects and dropping a Durable consumer. */
function changedOf(next: Next, json: unknown, prefix: string | null): unknown {
  const sites = textSitesOf(json);
  if (sites.length === 0) {
    return json;
  }
  const subjects = subjectSitesOf(sites);
  const consumers = sites.filter(({ isKey, path }) => isKey && path[0] === 'durableConsumers');
  const [first, second] = [pick(next, subjects), pick(next, subjects)];
  const draw = next();
  if (draw < 0.5) {
    const site = pick(next, sites);
    const text = partReplacedOf(next, site, prefix);
    return text === undefined ? json : withText(json, site, text);
  }
  if (draw < 0.75 && first !== undefined && second !== undefined) {
    return withText(withText(json, first, second.text), second, first.text);
  }
  const dropped = pick(next, consumers);
  return dropped === undefined ? json : withoutEntry(json, dropped.path);
}

describe('a printed plan with one name replaced, two subjects swapped or a Durable consumer dropped', () => {
  test('is refused, or is the plan its names print, by a Service declared back from them', () => {
    const next = seededNext(5162);
    const outcomes: { readonly outcome: string; readonly failure?: unknown }[] = [];
    for (const { plan, prefix } of printed) {
      const json: unknown = JSON.parse(JSON.stringify(plan));
      const changed = changedOf(next, json, prefix);
      if (JSON.stringify(changed) !== JSON.stringify(json)) {
        const decoded = decodeBrokerPlan(changed);
        const verdict = decoded.kind === 'malformed' ? 'refused' : verdictOf(decoded.plan);
        const isRight = verdict === 'refused' || verdict === 'matches' || verdict === 'excluded';
        outcomes.push(
          isRight ? { outcome: verdict } : { outcome: verdict, failure: { changed, verdict } },
        );
      }
    }
    const count = (outcome: string) => outcomes.filter((one) => one.outcome === outcome).length;

    expect(
      outcomes.filter(({ failure }) => failure !== undefined).map(({ failure }) => failure),
    ).toEqual([]);
    expect(count('refused')).toBeGreaterThan(200);
    expect(count('matches')).toBeGreaterThan(40);
    expect(count('excluded')).toBeGreaterThan(0);
    expect(count('excluded')).toBeLessThan(outcomes.length / 20);
  });
});
