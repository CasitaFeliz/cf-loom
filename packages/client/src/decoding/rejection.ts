import {
  type AnswerableRejection,
  invalidInputBody,
  isStandardRejection,
  parseValue,
  type RejectionEnvelope,
  schemaOf,
} from '@casitafeliz/loom-contract/internal';
import type * as core from 'zod/v4/core';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { type DecodedOutcome, invalidOutcomeOf, issuesAt } from './outcomes.ts';

/**
 * A Rejection Envelope as the Caller receives it: a code the Endpoint answers, with its body read
 * by its Reader schema and any body dropped where it declares none, or a code it does not know.
 */
export function rejectionOf(
  envelope: RejectionEnvelope['rejection'],
  called: CalledEndpoint,
): DecodedOutcome {
  const { code, message, body } = envelope;
  const rejection = called.rejectionsByCode.get(code);
  if (rejection === undefined) {
    return { kind: 'rejection', known: false, code, message, body };
  }
  const schema = bodySchemaOf(rejection);
  if (schema === undefined) {
    return { kind: 'rejection', known: true, code, message, body: undefined };
  }
  const parsed = parseValue(schema, body);
  if (parsed.kind === 'issues') {
    return invalidOutcomeOf({ committed: 'unknown', issues: issuesAt('body', parsed) });
  }
  return { kind: 'rejection', known: true, code, message, body: parsed.value };
}

/** The schema a Rejection's body is read with: cf-loom's for invalid input, else its declared one. */
function bodySchemaOf(rejection: AnswerableRejection): core.$ZodType | undefined {
  if (!isStandardRejection(rejection)) {
    return schemaOf(rejection, 'body');
  }
  return rejection.name === 'invalidInput' ? invalidInputBody : undefined;
}
