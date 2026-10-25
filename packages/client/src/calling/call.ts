import type { Http } from '@cf-loom/contract';
import { type InputIssue, invalidInputBodyOf } from '@cf-loom/contract/internal';
import { type DecodedOutcome, outcomeOf, rejectionOf } from '../decoding/index.ts';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { type InferFault, notSentFaultOf, thrownFaultOf } from '../inference/index.ts';
import { readyInputOf, requestOf } from '../request/index.ts';
import type { CallOptions } from './client-types.ts';
import { type ConfiguredHeaders, withConfiguredHeaders } from './configured.ts';

/** What every call of one client shares: where it sends, how, and what it does with an answer. */
export type Calling = {
  readonly base: URL;
  readonly fetch: Http;
  readonly headers: ConfiguredHeaders;
  readonly inferFault: InferFault | undefined;
};

/** One method of a client, before its Endpoint types what it takes and returns. */
export type ClientMethod = (input?: unknown, call?: CallOptions) => Promise<DecodedOutcome>;

/**
 * One Endpoint's method: each call top to bottom, its Input made ready to travel, or the
 * invalid-input Rejection the Provider would answer, unsent; then sent; then decoded, and the
 * response's Deprecation told.
 */
export function methodOf(
  called: CalledEndpoint,
  calling: Calling,
  watch: (response: Response) => void,
): ClientMethod {
  return async (input, call) => {
    const signal = call?.signal;
    if (signal !== undefined && isAborted(signal)) {
      return notSentFaultOf(signal);
    }
    const passed = fieldsOf(input);
    const headers = await withConfiguredHeaders(called, calling.headers, passed['headers']);
    const ready = await readyInputOf(called.endpoint, { ...passed, headers });
    if (ready.kind === 'invalid') {
      return invalidInputOf(called, ready.issues);
    }
    if (signal !== undefined && isAborted(signal)) {
      return notSentFaultOf(signal);
    }
    const sent = requestOf(called.endpoint, calling.base, ready.input);
    const request = signal === undefined ? sent : new Request(sent, { signal });
    const inferring = { signal, inferFault: calling.inferFault };
    let response: Response;
    try {
      response = await calling.fetch(request);
    } catch (e) {
      return thrownFaultOf(e, inferring) ?? rethrown(e);
    }
    const outcome = await outcomeOf(response, called, inferring);
    watch(response);
    return outcome;
  };
}

/** The invalid-input Rejection the Provider would answer, read as its response would be, never sent. */
function invalidInputOf(called: CalledEndpoint, issues: readonly InputIssue[]): DecodedOutcome {
  const { code, status, message } = called.standards.invalidInput;
  return rejectionOf({ code, message, body: invalidInputBodyOf(issues) }, status, called);
}

/** Whether a signal is aborted now: a header function awaited before may have aborted it. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function rethrown(error: unknown): never {
  throw error;
}

function fieldsOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? { ...value } : {};
}
