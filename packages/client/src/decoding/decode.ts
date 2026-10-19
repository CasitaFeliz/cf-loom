import { bodyOf, envelopeOf, isJsonContentType } from '@casitafeliz/loom-contract/internal';
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
  const read = await envelopeBodyOf(response);
  switch (read.kind) {
    case 'unreadable':
      return answeredFaultOf(
        { kind: 'unreadable-body', status, headers, error: read.error },
        inferring,
      );
    case 'none':
      return answeredFaultOf({ kind: 'status', status, headers }, inferring);
    case 'value': {
      const decoded = envelopeOutcomeOf(read.value, called, headers);
      return decoded ?? answeredFaultOf({ kind: 'status', status, headers }, inferring);
    }
  }
}

/** A body that may be an Envelope: JSON by its content type, else not read at all. */
type EnvelopeBody =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'unreadable'; readonly error: unknown }
  | { readonly kind: 'none' };

async function envelopeBodyOf(response: Response): Promise<EnvelopeBody> {
  if (!isJsonContentType(response.headers.get('content-type'))) {
    await response.body?.cancel();
    return { kind: 'none' };
  }
  const read = await bodyOf(response, undefined);
  switch (read.kind) {
    case 'value':
      return read;
    case 'unreadable':
      return { kind: 'unreadable', error: read.error };
    case 'malformed':
    case 'too-large':
      return { kind: 'none' };
  }
}

/** The Outcome an Envelope carries, with its response's `Retry-After`; none for any other body. */
function envelopeOutcomeOf(
  value: unknown,
  called: CalledEndpoint,
  headers: Headers,
): DecodedOutcome | undefined {
  const envelope = envelopeOf(value);
  if (envelope === undefined) {
    return undefined;
  }
  if ('rejection' in envelope) {
    return rejectionOf(envelope.rejection, called);
  }
  return withRetryAfter({ kind: 'fault', ...envelope.fault }, headers);
}
