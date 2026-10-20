import {
  faultResponseOf,
  follows,
  rejectionResponseOf,
  reservedCodes,
  reservedResponseOf,
  upperSnakeCase,
} from '@casitafeliz/loom-contract/internal';
import { mistakeOf } from '../mistakes/index.ts';
import { type ListedEndpoint, whoOf } from '../provided/index.ts';
import type { Answer } from '../scripting/index.ts';
import { knownRejectionResponseOf, scriptedSuccessResponseOf } from './outcomes.ts';

/** The status a scripted code the Provider does not declare travels with. */
const unknownRejectionStatus = 422;

/** A scripted answer as the Provider would send it; a network failure thrown as `fetch` throws it. */
export function responseOf(answer: Answer, listed: ListedEndpoint): Response {
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

/**
 * A code the Provider does not declare, as a later Provider might send it: never one the Endpoint
 * answers, a reserved one or one no Contract could declare, and with a JSON body.
 */
function unknownRejectionResponseOf(answer: UnknownRejection, listed: ListedEndpoint): Response {
  const refused = refusedUnknownCodeOf(answer.code, listed);
  if (refused !== undefined) {
    throw mistakeOf({ ...whoOf(listed), what: refused });
  }
  const { code, message, body } = answer;
  const what = `the scripted ${code} body is no JSON`;
  return builtOf(listed, what, () =>
    rejectionResponseOf({ code, status: unknownRejectionStatus, message, body }),
  );
}

/** Why a code cannot stand for one the Provider does not declare, if it cannot. */
function refusedUnknownCodeOf(code: string, listed: ListedEndpoint): string | undefined {
  if (listed.rejectionsByCode.has(code)) {
    return `${code} is a code the Endpoint answers, not one the Provider does not declare`;
  }
  if (reservedCodes.some((reserved) => reserved === code)) {
    return `${code} is a reserved code, which r.fault({ code }) answers`;
  }
  if (!follows(upperSnakeCase, code)) {
    return `${code} is no ${upperSnakeCase.name}, so no Contract can declare it`;
  }
  return undefined;
}

type BareStatus = Extract<Answer, { readonly kind: 'status' }>;

/** A status with no Envelope, from which the client infers its Fault; never the Success's. */
function bareStatusResponseOf({ status, headers }: BareStatus, listed: ListedEndpoint): Response {
  const isInferred =
    Number.isInteger(status) &&
    status >= 200 &&
    status <= 599 &&
    status !== listed.endpoint.success.status;
  if (!isInferred) {
    const what = `r.status takes an integer status from 200 to 599 other than the Success's, not ${status}`;
    throw mistakeOf({ ...whoOf(listed), what });
  }
  const what = 'the headers given to r.status cannot be sent';
  return builtOf(listed, what, () => new Response(null, { status, headers }));
}

/** A response built from what a step scripted, or the test's mistake, what failed kept as `cause`. */
function builtOf(listed: ListedEndpoint, what: string, build: () => Response): Response {
  try {
    return build();
  } catch (e) {
    throw mistakeOf({ ...whoOf(listed), what, cause: e });
  }
}
