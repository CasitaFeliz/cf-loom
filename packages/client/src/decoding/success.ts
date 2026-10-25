import type { Issue } from '@cf-loom/contract';
import {
  discardBodyOf,
  headerValuesOf,
  parseValue,
  receivedBodyOf,
} from '@cf-loom/contract/internal';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { type Answered, answeredFaultOf, type Inferring } from '../inference/index.ts';
import {
  type DecodedOutcome,
  type DecodedSuccess,
  invalidOutcomeOf,
  issuesAt,
} from './outcomes.ts';

/** A Success body as read: its value with the Issues that keep it from being one, bytes that are no JSON, or a failed stream. */
type SuccessBody =
  | { readonly kind: 'value'; readonly value: unknown; readonly issues: readonly Issue[] }
  | { readonly kind: 'not-json' }
  | { readonly kind: 'unreadable'; readonly error: unknown };

/** A Success's headers as read, and the Issues that keep them from being its own. */
type SuccessHeaders = {
  readonly value: Readonly<Record<string, unknown>>;
  readonly issues: readonly Issue[];
};

/** The Outcome a Caller receives for a response with the declared Success status. */
export async function successOf(
  response: Response,
  called: CalledEndpoint,
  inferring: Inferring,
): Promise<DecodedOutcome> {
  const headers = successHeadersOf(response.headers, called);
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
  const issues = [...headers.issues, ...body.issues];
  if (issues.length > 0) {
    return invalidOutcomeOf({ status, committed: 'yes', issues });
  }
  return declaredSuccessOf(called, status, { headers, body });
}

/** The Success with only the parts its Endpoint declares, so it is what a direct call of its Handler returns. */
function declaredSuccessOf(
  called: CalledEndpoint,
  status: number,
  read: { readonly headers: SuccessHeaders; readonly body: { readonly value: unknown } },
): DecodedSuccess {
  const { headers, body } = called.endpoint.success;
  return {
    kind: 'success',
    status,
    ...(headers === undefined ? {} : { headers: read.headers.value }),
    ...(body === undefined ? {} : { body: read.body.value }),
  };
}

/** The declared Success headers, each text converted by its node, then read with its schema. */
function successHeadersOf(received: Headers, called: CalledEndpoint): SuccessHeaders {
  const schema = called.endpoint.success.headers;
  if (schema === undefined || called.successHeaders === undefined) {
    return { value: {}, issues: [] };
  }
  const parsed = parseValue(schema, headerValuesOf(called.successHeaders, received));
  const value: Readonly<Record<string, unknown>> = parsed.kind === 'value' ? parsed.value : {};
  return { value, issues: issuesAt('success.headers', parsed) };
}

async function successBodyOf(response: Response, called: CalledEndpoint): Promise<SuccessBody> {
  const schema = called.endpoint.success.body;
  if (schema === undefined) {
    await discardBodyOf(response);
    return { kind: 'value', value: undefined, issues: [] };
  }
  const read = await receivedBodyOf(response);
  switch (read.kind) {
    case 'value': {
      const parsed = parseValue(schema, read.value);
      const value = parsed.kind === 'value' ? parsed.value : undefined;
      return { kind: 'value', value, issues: issuesAt('success.body', parsed) };
    }
    case 'malformed':
      return { kind: 'not-json' };
    case 'unreadable':
      return { kind: 'unreadable', error: read.error };
  }
}
