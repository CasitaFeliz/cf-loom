import type { Answered, Happened, InferFault, InferredFault, ReceivedFault } from './faults.ts';
import { withRetryAfter } from './faults.ts';

/** How the client infers Faults: the call's signal, and the organization's own inference. */
export type Inferring = {
  readonly signal?: AbortSignal | undefined;
  readonly inferFault?: InferFault | undefined;
};

/** An inference with its fixed message, which carries nothing received. */
type Inference = InferredFault & { readonly message: string };

/** The system error codes Node and undici give for a request that never reached the Provider. */
const noConnectionCodes: ReadonlySet<unknown> = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
]);

/** The system error codes Node and undici give for a connection lost after the request went out. */
const resetCodes: ReadonlySet<unknown> = new Set(['ECONNRESET', 'UND_ERR_SOCKET']);

const noConnection = 'No connection to the Provider';
const aborted = 'The request was aborted';
const timedOut = 'The request timed out';
const connectionFailed = 'The connection failed';

/**
 * The Fault inferred from what `fetch` threw; none for something that is no network failure, abort
 * or timeout, which reaches the Caller unchanged.
 */
export function thrownFaultOf(error: unknown, inferring: Inferring): ReceivedFault | undefined {
  const happened: Happened = { kind: 'thrown', error };
  const { signal } = inferring;
  const inference =
    signal?.aborted === true
      ? abortInferenceOf(signal.reason, 'unknown')
      : thrownInferenceOf(error);
  if (inference === undefined) {
    return undefined;
  }
  return { ...faultOf(happened, inference, inferring), cause: error };
}

/** The Fault inferred from a response that carried no Outcome, or whose body could not be read. */
export function answeredFaultOf(happened: Answered, inferring: Inferring): ReceivedFault {
  const inference = answeredInferenceOf(happened, inferring.signal);
  const fault = faultOf(happened, inference, inferring);
  switch (happened.kind) {
    case 'unreadable-body':
      return withRetryAfter({ ...fault, cause: happened.error }, happened.headers);
    case 'status':
      return withRetryAfter(fault, happened.headers);
  }
}

/** A Fault with cf-loom's message and the organization's inference, when it gives one. */
function faultOf(happened: Happened, inference: Inference, inferring: Inferring): ReceivedFault {
  const { committed, retryable } =
    inferring.inferFault?.(happened, {
      committed: inference.committed,
      retryable: inference.retryable,
    }) ?? inference;
  return { kind: 'fault', committed, retryable, message: inference.message };
}

/** The Fault of a call whose signal was aborted before anything was sent: committed `no`. */
export function notSentFaultOf(signal: AbortSignal): ReceivedFault {
  return { kind: 'fault', ...abortInferenceOf(signal.reason, 'no') };
}

function answeredInferenceOf(happened: Answered, signal: AbortSignal | undefined): Inference {
  switch (happened.kind) {
    case 'unreadable-body':
      return signal?.aborted === true
        ? abortInferenceOf(signal.reason, 'unknown')
        : { committed: 'unknown', retryable: true, message: connectionFailed };
    case 'status':
      return statusInferenceOf(happened.status);
  }
}

/** An aborted call, told a timeout or an abort by its reason's name, never by its class. */
function abortInferenceOf(reason: unknown, committed: 'no' | 'unknown'): Inference {
  const message = nameOf(reason) === 'TimeoutError' ? timedOut : aborted;
  return { committed, retryable: true, message };
}

function thrownInferenceOf(error: unknown): Inference | undefined {
  switch (nameOf(error)) {
    case 'TimeoutError':
    case 'AbortError':
      return abortInferenceOf(error, 'unknown');
    case 'TypeError':
      return networkInferenceOf(fieldOf(fieldOf(error, 'cause'), 'code'));
    default:
      return undefined;
  }
}

/** A network failure by its system error code; one with none, as browsers throw, is any other. */
function networkInferenceOf(code: unknown): Inference {
  if (noConnectionCodes.has(code)) {
    return { committed: 'no', retryable: true, message: noConnection };
  }
  const retryable = resetCodes.has(code);
  return { committed: 'unknown', retryable, message: connectionFailed };
}

function statusInferenceOf(status: number): Inference {
  const message = `The Provider answered ${status}`;
  if (status === 429) {
    return { committed: 'no', retryable: true, message };
  }
  return { committed: 'unknown', retryable: status === 503, message };
}

function nameOf(value: unknown): unknown {
  return fieldOf(value, 'name');
}

function fieldOf(value: unknown, field: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, field) : undefined;
}
