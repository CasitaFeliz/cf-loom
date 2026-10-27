import { receivedEnvelopeOf } from '@cf-loom/contract/internal';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { answeredFaultOf, type Inferring, withRetryAfter } from '../inference/index.ts';
import type { DecodedOutcome } from './outcomes.ts';
import { rejectionOf } from './rejection.ts';
import { successOf } from './success.ts';

/** The Outcome a Caller sees for one HTTP response. */
export async function outcomeOf(
  response: Response,
  called: CalledEndpoint,
  inferring: Inferring,
): Promise<DecodedOutcome> {
  if (response.status === called.endpoint.success.status) {
    return await successOf(response, called, inferring);
  }
  const { status, headers } = response;
  const read = await receivedEnvelopeOf(response);
  switch (read.kind) {
    case 'unreadable': {
      const happened = { kind: 'unreadable-body', status, headers, error: read.error } as const;
      return answeredFaultOf(happened, inferring);
    }
    case 'none':
      return answeredFaultOf({ kind: 'status', status, headers }, inferring);
    case 'envelope': {
      const { envelope } = read;
      if ('rejection' in envelope) {
        return rejectionOf(envelope.rejection, { status, headers, source: 'provider' }, called);
      }
      return withRetryAfter(
        { kind: 'fault', ...envelope.fault, source: 'provider', status },
        headers,
      );
    }
  }
}
