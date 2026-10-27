import type { Http } from '@cf-loom/contract';
import { type InputIssue, invalidInputBodyOf } from '@cf-loom/contract/internal';
import { type DecodedOutcome, outcomeOf, rejectionOf } from '../decoding/index.ts';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { type InferFault, notSentFaultOf, thrownFaultOf } from '../inference/index.ts';
import { type ReadyInput, readyInputOf, requestOf } from '../request/index.ts';
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
 * One Endpoint's method: each call top to bottom, its headers and Input made ready to travel, or
 * the invalid-input Rejection the Provider would answer, unsent; then sent; then decoded, and the
 * response's Deprecation told. A signal aborted before it is sent returns its Fault.
 */
export function methodOf(
  called: CalledEndpoint,
  calling: Calling,
  watch: (response: Response) => void,
): ClientMethod {
  return async (input, call = {}) => {
    const { signal } = call;
    const readied = await readiedOf(called, calling, { passed: fieldsOf(input), call });
    if (signal?.aborted) {
      return notSentFaultOf(signal);
    }
    if (readied.kind === 'threw') {
      throw readied.error;
    }
    if (readied.kind === 'invalid') {
      return invalidInputOf(called, readied.issues);
    }
    const sent = requestOf(called.endpoint, calling.base, readied.input);
    const request = signal === undefined ? sent : new Request(sent, { signal });
    const inferring = { signal, inferFault: calling.inferFault };
    const send = calling.fetch;
    let response: Response;
    try {
      response = await send(request);
    } catch (e) {
      return thrownFaultOf(e, inferring) ?? rethrown(e);
    }
    const outcome = await outcomeOf(response, called, inferring);
    watch(response);
    return outcome;
  };
}

/** What reading a call's headers and Input came to: the Input, or what a Caller's code threw. */
type Readied = ReadyInput | { readonly kind: 'threw'; readonly error: unknown };

/** The headers given to `client()` and the Input read together, so one check decides an abort. */
async function readiedOf(
  called: CalledEndpoint,
  calling: Calling,
  {
    passed,
    call,
  }: { readonly passed: Readonly<Record<string, unknown>>; readonly call: CallOptions },
): Promise<Readied> {
  try {
    const headers = await withConfiguredHeaders(called, calling.headers, {
      passed: passed['headers'],
      call,
    });
    return await readyInputOf(called.endpoint, { ...passed, headers });
  } catch (error) {
    return { kind: 'threw', error };
  }
}

/** The invalid-input Rejection the Provider would answer, read as its response would be, never sent. */
function invalidInputOf(called: CalledEndpoint, issues: readonly InputIssue[]): DecodedOutcome {
  const { code, status, message } = called.standards.invalidInput;
  const envelope = { code, message, body: invalidInputBodyOf(issues) };
  return rejectionOf(envelope, { status, headers: new Headers(), source: 'client' }, called);
}

function rethrown(error: unknown): never {
  throw error;
}

function fieldsOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null ? { ...value } : {};
}
