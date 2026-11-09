import { z } from 'zod';
import { everyKeyRecordOf, type Problem, problemLineOf, readWith } from '../validation/index.ts';
import type { Path } from '../walker/index.ts';
import {
  brokerPrefixRule,
  isBrokerPrefix,
  isPrefixedName,
  isPrefixedSubject,
} from '../wire/index.ts';
import type { BrokerPlan } from './broker-plan.ts';

/** A value read as a broker plan: the plan, or the first place it breaks the shape of the `plan` of the document `cf-loom broker-plan --json` prints. */
export type DecodedBrokerPlan =
  | { readonly kind: 'decoded'; readonly plan: BrokerPlan }
  | { readonly kind: 'malformed'; readonly reason: string };

const notStreamName = 'is not a Stream name: a Service name after the prefix';
const notDurableConsumerName =
  'is not a Durable consumer name: a Service name, then a Subscription name or a Command Version';

const text = z.string('is not a text');
const stream = z.strictObject({
  service: text,
  subjects: z.array(text).min(1, 'holds no subject'),
});
const durableConsumer = z.strictObject({ service: text, stream: text, subject: text });
const plan = z.strictObject({
  prefix: z
    .string('is not a text or null')
    .refine(isBrokerPrefix, `is not ${brokerPrefixRule}`)
    .nullable(),
  streams: everyKeyRecordOf(stream, notStreamName),
  durableConsumers: everyKeyRecordOf(durableConsumer, notDurableConsumerName),
});

/**
 * Reads a value as the `plan` of the document `cf-loom broker-plan --json` prints, refusing any other
 * shape, so the document itself, an errors document or a hand-edited plan never reaches a Broker.
 */
export function decodeBrokerPlan(value: unknown): DecodedBrokerPlan {
  const structured = readWith(plan, value, 'the Broker plan');
  if (structured.kind === 'refused') {
    return malformedAt(structured.problems[0]);
  }
  const problem = uncarriedProblemOf(structured.value);
  return problem === undefined ? { kind: 'decoded', plan: structured.value } : malformedAt(problem);
}

function malformedAt(problem: Problem): DecodedBrokerPlan {
  return { kind: 'malformed', reason: problemLineOf(problem) };
}

/** A name or subject of the plan, where it sits and whether it carries the plan's prefix. */
type Carrier = { readonly at: Path; readonly isCarried: boolean };

function uncarriedProblemOf(brokerPlan: BrokerPlan): Problem | undefined {
  const { prefix } = brokerPlan;
  if (prefix === null) {
    return undefined;
  }
  const uncarried = carriersOf(brokerPlan, prefix).find((carrier) => !carrier.isCarried);
  if (uncarried === undefined) {
    return undefined;
  }
  return { at: uncarried.at, reason: `does not carry the prefix ${prefix}` };
}

function carriersOf(brokerPlan: BrokerPlan, prefix: string): readonly Carrier[] {
  const carriers: Carrier[] = [];
  for (const [name, { subjects }] of Object.entries(brokerPlan.streams)) {
    carriers.push({ at: ['streams', name], isCarried: isPrefixedName(prefix, name) });
    for (const [index, subject] of subjects.entries()) {
      const at = ['streams', name, 'subjects', index];
      carriers.push({ at, isCarried: isPrefixedSubject(prefix, subject) });
    }
  }
  for (const [name, durableConsumer] of Object.entries(brokerPlan.durableConsumers)) {
    const at = ['durableConsumers', name];
    carriers.push({ at, isCarried: isPrefixedName(prefix, name) });
    carriers.push({
      at: [...at, 'stream'],
      isCarried: isPrefixedName(prefix, durableConsumer.stream),
    });
    carriers.push({
      at: [...at, 'subject'],
      isCarried: isPrefixedSubject(prefix, durableConsumer.subject),
    });
  }
  return carriers;
}
