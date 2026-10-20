import {
  parseValue,
  type RejectionEnvelope,
  rejectionBodyReaderOf,
} from '@cf-loom/contract/internal';
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
  const schema = rejectionBodyReaderOf(rejection);
  if (schema === undefined) {
    return { kind: 'rejection', known: true, code, message, body: undefined };
  }
  const parsed = parseValue(schema, body);
  if (parsed.kind === 'issues') {
    return invalidOutcomeOf({ committed: 'unknown', issues: issuesAt('body', parsed) });
  }
  return { kind: 'rejection', known: true, code, message, body: parsed.value };
}
