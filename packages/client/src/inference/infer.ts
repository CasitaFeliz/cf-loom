import {
  type Answered,
  type Happened,
  type InferFault,
  type InferredFault,
  type ReceivedFault,
  withRetryAfter,
} from './faults.ts';
import { abortedHappenedOf, answeredHappenedOf, thrownHappenedOf } from './happened.ts';

/** How the client infers Faults: the call's signal, and the organization's own inference. */
export type Inferring = {
  readonly signal?: AbortSignal | undefined;
  readonly inferFault?: InferFault | undefined;
};

/** An inference with its fixed message, which carries nothing received. */
type Inference = InferredFault & { readonly message: string };

/**
 * The Fault inferred from what `fetch` threw; none for something that is no network failure, abort
 * or timeout, which reaches the Caller unchanged.
 */
export function thrownFaultOf(error: unknown, inferring: Inferring): ReceivedFault | undefined {
  const happened = thrownHappenedOf(error, inferring.signal);
  return happened === undefined ? undefined : faultOf(happened, inferring);
}

/** The Fault inferred from a response that carried no Outcome, or whose body could not be read. */
export function answeredFaultOf(answered: Answered, inferring: Inferring): ReceivedFault {
  return faultOf(answeredHappenedOf(answered, inferring.signal), inferring);
}

/** The Fault of a call whose signal was aborted before anything was sent: committed `no`. */
export function notSentFaultOf(signal: AbortSignal): ReceivedFault {
  const happened = abortedHappenedOf(signal);
  return faultWith(happened, { ...inferenceOf(happened), committed: 'no' });
}

/** A Fault with cf-loom's inference of what happened, or the organization's when it gives one. */
function faultOf(happened: Happened, inferring: Inferring): ReceivedFault {
  const inferred = inferenceOf(happened);
  const { committed, retryable } =
    inferring.inferFault?.(happened, {
      committed: inferred.committed,
      retryable: inferred.retryable,
    }) ?? inferred;
  return faultWith(happened, { committed, retryable, message: inferred.message });
}

/** The Fault of what happened, with cf-loom's message and the details a Caller reads it by. */
function faultWith(happened: Happened, inference: Inference): ReceivedFault {
  const fault: ReceivedFault = {
    kind: 'fault',
    source: happened.kind,
    ...inference,
    ...detailsOf(happened),
  };
  return 'headers' in happened && happened.headers !== undefined
    ? withRetryAfter(fault, happened.headers)
    : fault;
}

/** What a Fault carries of what happened: the status when a response arrived, the error as `cause`. */
function detailsOf(happened: Happened): Pick<ReceivedFault, 'status' | 'cause'> {
  switch (happened.kind) {
    case 'no-connection':
    case 'connection-lost':
    case 'connection-failed':
      return { cause: happened.error };
    case 'aborted':
    case 'timeout': {
      const { status, error } = happened;
      return status === undefined ? { cause: error } : { status, cause: error };
    }
    case 'unreadable-body':
      return { status: happened.status, cause: happened.error };
    case 'status':
      return { status: happened.status };
  }
}

/** What cf-loom decides of what happened once the request was sent: its Fault and message. */
function inferenceOf(happened: Happened): Inference {
  switch (happened.kind) {
    case 'no-connection':
      return { committed: 'no', retryable: true, message: 'No connection to the Provider' };
    case 'aborted':
      return { committed: 'unknown', retryable: false, message: 'The request was aborted' };
    case 'timeout':
      return { committed: 'unknown', retryable: true, message: 'The request timed out' };
    case 'connection-lost':
      return { committed: 'unknown', retryable: true, message: 'The connection failed' };
    case 'connection-failed':
      return { committed: 'unknown', retryable: false, message: 'The connection failed' };
    case 'unreadable-body':
      return { committed: 'unknown', retryable: true, message: 'The connection failed' };
    case 'status':
      return statusInferenceOf(happened.status);
  }
}

function statusInferenceOf(status: number): Inference {
  const message = `The Provider answered ${status}`;
  if (status === 429) {
    return { committed: 'no', retryable: true, message };
  }
  return { committed: 'unknown', retryable: status === 503, message };
}
