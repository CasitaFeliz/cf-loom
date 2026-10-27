import { discardBodyOf, readShapeOf, receivedBodyOf } from '@cf-loom/contract/internal';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { type Answered, answeredFaultOf, type Inferring } from '../inference/index.ts';
import { type DecodedOutcome, invalidOutcomeOf, receivedFieldsOf } from './outcomes.ts';

/** A Success body as received: its value, bytes that are no JSON, or a failed stream. */
type SuccessBody =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'not-json' }
  | { readonly kind: 'unreadable'; readonly error: unknown };

/** The Outcome a Caller receives for a response with the declared Success status. */
export async function successOf(
  response: Response,
  called: CalledEndpoint,
  inferring: Inferring,
): Promise<DecodedOutcome> {
  const body = await successBodyOf(response, called);
  const { status, headers: received } = response;
  if (body.kind === 'unreadable') {
    const happened: Answered = {
      kind: 'unreadable-body',
      status,
      headers: received,
      error: body.error,
    };
    return answeredFaultOf(happened, inferring);
  }
  if (body.kind === 'not-json') {
    return answeredFaultOf({ kind: 'status', status, headers: received }, inferring);
  }
  const fields = receivedFieldsOf(called.success, received, body.value);
  const read = readShapeOf(called.success.shape, fields);
  if (read.kind === 'issues') {
    return invalidOutcomeOf({ status, committed: 'yes', issues: read.issues });
  }
  return { kind: 'success', status, ...read.value };
}

async function successBodyOf(response: Response, called: CalledEndpoint): Promise<SuccessBody> {
  if (called.success.shape.body.schema === undefined) {
    await discardBodyOf(response);
    return { kind: 'value', value: undefined };
  }
  const read = await receivedBodyOf(response);
  switch (read.kind) {
    case 'value':
      return { kind: 'value', value: read.value };
    case 'malformed':
      return { kind: 'not-json' };
    case 'unreadable':
      return { kind: 'unreadable', error: read.error };
  }
}
