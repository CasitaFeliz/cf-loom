import {
  parseValue,
  type RejectionEnvelope,
  rejectionBodyReaderOf,
} from '@cf-loom/contract/internal';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { type DecodedOutcome, invalidOutcomeOf, issuesAt } from './outcomes.ts';

/**
 * A Rejection Envelope as the Caller receives it: a code the Endpoint answers, with its body read
 * by its Reader schema and none where it declares none, or a code it does not know.
 */
export function rejectionOf(
  envelope: RejectionEnvelope['rejection'],
  status: number,
  called: CalledEndpoint,
): DecodedOutcome {
  const { code, message, body } = envelope;
  const rejection = called.rejectionsByCode.get(code);
  if (rejection === undefined) {
    const unknown = {
      kind: 'unknown-rejection',
      source: 'provider',
      code,
      status,
      message,
    } as const;
    return body === undefined ? unknown : { ...unknown, body };
  }
  const known = { kind: 'rejection', source: 'provider', code, status, message } as const;
  const schema = rejectionBodyReaderOf(rejection, called.standards);
  if (schema === undefined) {
    return known;
  }
  const parsed = parseValue(schema, body);
  if (parsed.kind === 'issues') {
    return invalidOutcomeOf({ status, committed: 'unknown', issues: issuesAt('body', parsed) });
  }
  return { ...known, body: parsed.value };
}
