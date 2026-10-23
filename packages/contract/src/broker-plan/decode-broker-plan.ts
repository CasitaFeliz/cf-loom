import { z } from 'zod';
import type { $ZodRawIssue } from 'zod/v4/core';
import { type Problem, problemOf } from '../decoding/index.ts';
import { locationOf } from '../validation/index.ts';
import type { Path } from '../walker/index.ts';
import { isBrokerPrefix, prefixedNameOf, prefixedSubjectOf } from '../wire/index.ts';
import type { BrokerPlan } from './broker-plan.ts';

/** A value read as a broker plan: the plan, or the first place it breaks the shape `cf-loom broker-plan --json` prints. */
export type DecodedBrokerPlan =
  | { readonly kind: 'decoded'; readonly plan: BrokerPlan }
  | { readonly kind: 'malformed'; readonly reason: string };

function wrongType(reason: string) {
  return {
    error: (issue: $ZodRawIssue) => {
      if (issue.code !== 'invalid_type') {
        return undefined;
      }
      return issue.input === undefined ? 'is missing' : reason;
    },
  };
}

const text = z.string(wrongType('is not a text'));
const stream = z.strictObject(
  {
    service: text,
    subjects: z.array(text, wrongType('is not a list')).min(1, 'holds no subject'),
  },
  wrongType('is not an object'),
);
const consumer = z.strictObject(
  { service: text, stream: text, subject: text },
  wrongType('is not an object'),
);
const plan = z.strictObject(
  {
    prefix: z
      .string(wrongType('is not a text or null'))
      .refine(isBrokerPrefix, 'is not kebab-case, such as staging')
      .nullable(),
    streams: z.record(z.string(), stream, wrongType('is not an object')),
    consumers: z.record(z.string(), consumer, wrongType('is not an object')),
  },
  wrongType('is not an object'),
);

/**
 * Reads a value as the broker plan `cf-loom broker-plan --json` prints, refusing any other shape, so
 * an errors document or a hand-edited plan never reaches a Broker.
 */
export function decodeBrokerPlan(value: unknown): DecodedBrokerPlan {
  const structured = plan.safeParse(value);
  if (!structured.success) {
    return malformedAt(problemOf(structured.error.issues, 'the broker plan'));
  }
  const problem = uncarriedProblemOf(structured.data);
  return problem === undefined ? { kind: 'decoded', plan: structured.data } : malformedAt(problem);
}

function malformedAt(problem: Problem): DecodedBrokerPlan {
  return { kind: 'malformed', reason: `${locationOf(problem.at)} ${problem.reason}` };
}

/** A name or subject of the plan, and what a prefixed plan must start it with. */
type Carrier = { readonly at: Path; readonly text: string; readonly start: string };

function uncarriedProblemOf(brokerPlan: BrokerPlan): Problem | undefined {
  if (brokerPlan.prefix === null) {
    return undefined;
  }
  const uncarried = carriersOf(brokerPlan, brokerPlan.prefix).find(
    (carrier) => !carrier.text.startsWith(carrier.start),
  );
  if (uncarried === undefined) {
    return undefined;
  }
  return { at: uncarried.at, reason: `does not start with ${uncarried.start}` };
}

function carriersOf(brokerPlan: BrokerPlan, prefix: string): readonly Carrier[] {
  const name = prefixedNameOf(prefix, '');
  const subject = prefixedSubjectOf(prefix, '');
  const carriers: Carrier[] = [];
  for (const [streamName, { subjects }] of Object.entries(brokerPlan.streams)) {
    carriers.push({ at: ['streams', streamName], text: streamName, start: name });
    for (const [index, text] of subjects.entries()) {
      carriers.push({ at: ['streams', streamName, 'subjects', index], text, start: subject });
    }
  }
  for (const [consumerName, consumer] of Object.entries(brokerPlan.consumers)) {
    const at = ['consumers', consumerName];
    carriers.push({ at, text: consumerName, start: name });
    carriers.push({ at: [...at, 'stream'], text: consumer.stream, start: name });
    carriers.push({ at: [...at, 'subject'], text: consumer.subject, start: subject });
  }
  return carriers;
}
