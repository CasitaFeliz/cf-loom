import { z } from 'zod';
import { everyKeyRecordOf, type Problem, problemLineOf, readWith } from '../validation/index.ts';
import { brokerPrefixRule, isBrokerPrefix } from '../wire/index.ts';
import type { BrokerPlan } from './broker-plan.ts';
import { unprintedProblemOf } from './printed-plan.ts';
import { notDurableConsumerName, notStreamName, readPlan } from './read-plan.ts';

/** A value read as a broker plan: the plan, or the first place it breaks the shape of the `plan` of the document `cf-loom broker-plan --json` prints. */
export type DecodedBrokerPlan =
  | { readonly kind: 'decoded'; readonly plan: BrokerPlan }
  | { readonly kind: 'malformed'; readonly reason: string };

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
 * Reads a value as the `plan` of the document `cf-loom broker-plan --json` prints. Each name, subject and Service
 * name is read back into the names it is built from, which must follow their grammars and print it again unchanged,
 * and the plan must be the one Service's plan those names print, in its order; any other value is refused at the
 * first place it differs, so the document itself, an errors document or a hand-edited plan never reaches a Broker.
 */
export function decodeBrokerPlan(value: unknown): DecodedBrokerPlan {
  const structured = readWith(plan, value, 'the Broker plan');
  if (structured.kind === 'refused') {
    return malformedAt(structured.problems[0]);
  }
  const read = readPlan(structured.value);
  if (read.kind === 'refused') {
    return malformedAt(read.problems[0]);
  }
  const problem = unprintedProblemOf(structured.value, read.value);
  return problem === undefined ? { kind: 'decoded', plan: structured.value } : malformedAt(problem);
}

function malformedAt(problem: Problem): DecodedBrokerPlan {
  return { kind: 'malformed', reason: problemLineOf(problem) };
}
