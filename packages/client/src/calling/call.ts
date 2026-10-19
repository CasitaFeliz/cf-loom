import { type InputIssue, invalidInputBodyOf } from '@casitafeliz/loom-contract/internal';
import type { DecodedOutcome } from '../decoding/index.ts';
import { outcomeOf } from '../decoding/index.ts';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { type InferFault, notSentFaultOf, thrownFaultOf } from '../inference/index.ts';
import { readyInputOf, sendingOf } from '../request/index.ts';
import type { CallOptions } from './client-types.ts';
import { type ConfiguredHeaders, withConfiguredHeaders } from './configured.ts';

/** A `fetch`, the global one or the one given to `client()`. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** What every call of one client shares: where it sends, how, and what it does with an answer. */
export type Calling = {
  readonly base: URL;
  readonly fetch: Fetch;
  readonly headers: ConfiguredHeaders;
  readonly inferFault: InferFault | undefined;
};

/** One method of a client: an Endpoint called, and each response watched for its Deprecation. */
export type MethodOf = {
  readonly called: CalledEndpoint;
  readonly watch: (response: Response) => void;
};

/**
 * One call top to bottom: the Input made ready to travel, or the invalid-input Rejection the
 * Provider would answer, unsent; then sent, unless the signal already aborted; then decoded.
 */
export async function callOf(
  method: MethodOf,
  calling: Calling,
  passed: { readonly input: unknown; readonly call: CallOptions | undefined },
): Promise<DecodedOutcome> {
  const { called } = method;
  const headers = await withConfiguredHeaders(
    called,
    calling.headers,
    fieldOf(passed.input, 'headers'),
  );
  const ready = readyInputOf(called.endpoint, { ...fieldsOf(passed.input), headers });
  if (ready.kind === 'invalid') {
    return invalidInputOf(called, ready.issues);
  }
  const signal = passed.call?.signal;
  if (signal?.aborted === true) {
    return notSentFaultOf(signal);
  }
  const { url, init } = sendingOf(called.endpoint, calling.base, ready.input);
  const inferring = { signal, inferFault: calling.inferFault };
  let response: Response;
  try {
    response = await calling.fetch(url, signal === undefined ? init : { ...init, signal });
  } catch (e) {
    return thrownFaultOf(e, inferring) ?? rethrown(e);
  }
  method.watch(response);
  return await outcomeOf(response, called, inferring);
}

/** The invalid-input Rejection the Provider would answer, with its code and message, never sent. */
function invalidInputOf(called: CalledEndpoint, issues: readonly InputIssue[]): DecodedOutcome {
  const { code, message } = called.standards.invalidInput;
  return { kind: 'rejection', known: true, code, message, body: invalidInputBodyOf(issues) };
}

function rethrown(error: unknown): never {
  throw error;
}

function fieldsOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? { ...value } : {};
}

function fieldOf(value: unknown, field: string): unknown {
  return fieldsOf(value)[field];
}
