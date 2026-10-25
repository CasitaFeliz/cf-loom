import {
  faultResponseOf,
  follows,
  isJsonValue,
  isReservedCode,
  methodNotAllowedResponseOf,
  type ReservedCode,
  rejectionResponseOf,
  reservedResponseOf,
  upperSnakeCase,
} from '@cf-loom/contract/internal';
import { FakeProviderError, mistakeOf } from '../mistakes/index.ts';
import { type ListedEndpoint, type Matched, whoOf } from '../provided/index.ts';
import type { Answer } from '../scripting/index.ts';
import { knownRejectionResponseOf, scriptedSuccessResponseOf } from './outcomes.ts';

/** The status a scripted code the Provider does not declare travels with. */
const unknownRejectionStatus = 422;

/** What a mistake says when a scripted answer throws while it is read. */
const unsendable = 'the scripted answer cannot be sent';

/**
 * A scripted answer as the Provider would send it, a network failure thrown as `fetch` throws it;
 * whatever throws while an answer is read is the test's mistake.
 */
export function responseOf(answer: Answer, { listed, otherMethods }: Matched): Response {
  switch (answer.kind) {
    case 'success':
      return builtOf(listed, unsendable, () => scriptedSuccessResponseOf(answer.success, listed));
    case 'rejection':
      return builtOf(listed, unsendable, () => knownRejectionResponseOf(answer, listed));
    case 'unknown-rejection':
      return builtOf(listed, unsendable, () => unknownRejectionResponseOf(answer, listed));
    case 'fault':
      return builtOf(listed, unsendable, () => faultResponseOf(answer));
    case 'reserved':
      return builtOf(listed, unsendable, () => reservedAnswerOf(answer.code, otherMethods));
    case 'no-connection':
      throw networkFailureOf('ECONNREFUSED');
    case 'reset':
      throw networkFailureOf('ECONNRESET');
    case 'status':
      return builtOf(listed, unsendable, () => bareStatusResponseOf(answer, listed));
  }
}

/** A reserved code as `serve` sends it: `METHOD_NOT_ALLOWED` with `Allow`, the methods the path takes. */
function reservedAnswerOf(code: ReservedCode, otherMethods: readonly string[]): Response {
  return code === 'METHOD_NOT_ALLOWED'
    ? methodNotAllowedResponseOf(otherMethods)
    : reservedResponseOf(code);
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
  return builtOf(listed, what, () => {
    if (!isJsonValue(body)) {
      throw mistakeOf({ ...whoOf(listed), what });
    }
    return rejectionResponseOf({ code, status: unknownRejectionStatus, message, body });
  });
}

/** Why a code cannot stand for one the Provider does not declare, if it cannot. */
function refusedUnknownCodeOf(code: string, listed: ListedEndpoint): string | undefined {
  if (listed.rejectionsByCode.has(code)) {
    return `${code} is a code the Endpoint answers, not one the Provider does not declare`;
  }
  if (isReservedCode(code)) {
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

/**
 * A response built from what a step scripted, or the test's mistake, what failed kept as `cause`;
 * a mistake found while it is built is thrown as it is.
 */
function builtOf(listed: ListedEndpoint, what: string, build: () => Response): Response {
  try {
    return build();
  } catch (e) {
    if (e instanceof FakeProviderError) {
      throw e;
    }
    throw mistakeOf({ ...whoOf(listed), what, cause: e });
  }
}
