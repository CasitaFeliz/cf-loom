import {
  faultResponseOf,
  rejectionResponseOf,
  reservedResponseOf,
  withDeprecation,
} from '@casitafeliz/loom-contract/internal';
import { mistakeOf } from '../mistakes/index.ts';
import type { ListedEndpoint } from '../provided/index.ts';
import type { Answer } from '../scripting/index.ts';
import { knownRejectionResponseOf, scriptedSuccessResponseOf } from './outcomes.ts';

/** The status a code the Provider does not declare travels with, as `serve` never sends it. */
const unknownRejectionStatus = 422;

/**
 * A scripted answer as the Provider would send it, its `Deprecation` included when the Endpoint is
 * Deprecated; a network failure is thrown as `fetch` throws it.
 */
export function responseOf(answer: Answer, listed: ListedEndpoint): Response {
  return withDeprecation(sentResponseOf(answer, listed), listed.deprecatedAt);
}

function sentResponseOf(answer: Answer, listed: ListedEndpoint): Response {
  switch (answer.kind) {
    case 'success':
      return scriptedSuccessResponseOf(answer.success, listed);
    case 'rejection':
      return knownRejectionResponseOf(answer, listed);
    case 'unknown-rejection':
      return unknownRejectionResponseOf(answer, listed);
    case 'fault': {
      const { committed, retryable, message } = answer;
      return faultResponseOf({ committed, retryable, message });
    }
    case 'reserved':
      return reservedResponseOf(answer.code);
    case 'no-connection':
      throw networkFailureOf('ECONNREFUSED');
    case 'reset':
      throw networkFailureOf('ECONNRESET');
    case 'status':
      return bareStatusResponseOf(answer, listed);
  }
}

/** What `fetch` throws when the connection is refused or reset, as Node's reports it. */
function networkFailureOf(code: 'ECONNREFUSED' | 'ECONNRESET'): TypeError {
  return new TypeError('fetch failed', { cause: { code } });
}

type UnknownRejection = Extract<Answer, { readonly kind: 'unknown-rejection' }>;

/** A code the Endpoint does not answer, as a later Provider might send it; never one it answers. */
function unknownRejectionResponseOf(answer: UnknownRejection, listed: ListedEndpoint): Response {
  if (listed.rejectionsByCode.has(answer.code)) {
    const what = `${answer.code} is a code the Endpoint answers, so it is no Unknown code`;
    throw mistakeOf({ provider: listed.provider, endpoint: listed.name, what });
  }
  const { code, message, body } = answer;
  return rejectionResponseOf({ code, status: unknownRejectionStatus, message, body });
}

type BareStatus = Extract<Answer, { readonly kind: 'status' }>;

/** A status with no Envelope, from which the client infers its Fault; never the Success's. */
function bareStatusResponseOf({ status, headers }: BareStatus, listed: ListedEndpoint): Response {
  const isInferred = status >= 200 && status <= 599 && status !== listed.endpoint.success.status;
  if (!isInferred) {
    const what = `r.status takes a status from 200 to 599 other than the Success's, not ${status}`;
    throw mistakeOf({ provider: listed.provider, endpoint: listed.name, what });
  }
  return new Response(null, { status, headers });
}
