import {
  discardBodyOf,
  headerValuesOf,
  type Issue,
  parseValue,
  receivedBodyOf,
} from '@cf-loom/contract/internal';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { answeredFaultOf, type Inferring } from '../inference/index.ts';
import { type DecodedOutcome, invalidOutcomeOf, issuesAt } from './outcomes.ts';

/** A Success body as read: its value, the Issues that keep it from being one, or a failed stream. */
type SuccessBody =
  | { readonly kind: 'value'; readonly value: unknown; readonly issues: readonly Issue[] }
  | { readonly kind: 'unreadable'; readonly error: unknown };

/** A Success's headers as read, and the Issues that keep them from being its own. */
type SuccessHeaders = {
  readonly value: Readonly<Record<string, unknown>>;
  readonly issues: readonly Issue[];
};

/**
 * A response with the declared Success status: its headers and body read with their Reader
 * schemas; one that breaks them is the Provider's committed answer the Contract does not describe.
 */
export async function successOf(
  response: Response,
  called: CalledEndpoint,
  inferring: Inferring,
): Promise<DecodedOutcome> {
  const headers = successHeadersOf(response.headers, called);
  const body = await successBodyOf(response, called);
  if (body.kind === 'unreadable') {
    const { status, headers: received } = response;
    const happened = {
      kind: 'unreadable-body',
      status,
      headers: received,
      error: body.error,
    } as const;
    return answeredFaultOf(happened, inferring);
  }
  const issues = [...headers.issues, ...body.issues];
  if (issues.length > 0) {
    return invalidOutcomeOf({ committed: 'yes', issues });
  }
  return { kind: 'success', value: body.value, headers: headers.value };
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
      return { kind: 'value', value: undefined, issues: [malformedSuccessIssueOf(read.message)] };
    case 'unreadable':
      return { kind: 'unreadable', error: read.error };
  }
}

/** A Success body that is no JSON: an Issue at the whole of `success.body`. */
function malformedSuccessIssueOf(message: string): Issue {
  return { part: 'success.body', path: [], code: 'malformed', message };
}
