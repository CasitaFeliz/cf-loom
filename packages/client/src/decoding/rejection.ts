import { type RejectionEnvelope, readShapeOf } from '@cf-loom/contract/internal';
import type { CalledEndpoint } from '../endpoints/index.ts';
import {
  type Arrival,
  type DecodedOutcome,
  invalidOutcomeOf,
  receivedFieldsOf,
} from './outcomes.ts';

/**
 * A Rejection Envelope as the Caller receives it: a code the Endpoint answers, with its headers
 * and body read by its Reader schemas and none where it declares none, or a code it does not know.
 */
export function rejectionOf(
  envelope: RejectionEnvelope['rejection'],
  arrival: Arrival,
  called: CalledEndpoint,
): DecodedOutcome {
  const { status, source } = arrival;
  const { code, message, body } = envelope;
  const answered = called.rejections.get(code);
  if (answered === undefined) {
    const unknown = {
      kind: 'unknown-rejection',
      source: 'provider',
      code,
      status,
      message,
    } as const;
    return body === undefined ? unknown : { ...unknown, body };
  }
  const read = readShapeOf(answered.shape, receivedFieldsOf(answered, arrival.headers, body));
  if (read.kind === 'issues') {
    return invalidOutcomeOf({ status, committed: 'unknown', issues: read.issues });
  }
  return { kind: 'rejection', source, code, status, message, ...read.value };
}
