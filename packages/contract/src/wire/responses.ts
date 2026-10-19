import type { ReservedCode } from '../declarations/index.ts';
import { jsonContentType } from './content-type.ts';
import {
  faultEnvelopeOf,
  faultStatusOf,
  rejectionEnvelopeOf,
  reservedFaults,
  type TravelingFault,
} from './envelopes.ts';

/** A Success as it is sent: its declared status, its headers as text that can travel, and its body. */
export type SentSuccess = {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly body?: unknown;
};

/** A Rejection as it is sent: its code, status and message resolved, and its body when it has one. */
export type SentRejection = {
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly body?: unknown;
};

/** The response of a Success: its status and headers, and its body as JSON when it has one. */
export function successResponseOf(success: SentSuccess): Response {
  const headers = new Headers();
  for (const [name, text] of success.headers) {
    headers.set(name, text);
  }
  if (success.body === undefined) {
    return new Response(null, { status: success.status, headers });
  }
  headers.set('content-type', jsonContentType);
  return new Response(JSON.stringify(success.body), { status: success.status, headers });
}

/** The response of a Rejection: its status and its Envelope. */
export function rejectionResponseOf(rejection: SentRejection): Response {
  return jsonResponseOf(rejection.status, rejectionEnvelopeOf(rejection));
}

/** The response of a Fault: the status it travels with and its Envelope, never its `cause`. */
export function faultResponseOf(fault: TravelingFault): Response {
  return jsonResponseOf(faultStatusOf(fault), faultEnvelopeOf(fault));
}

/** The response of a reserved code: its status, its `committed`, never retryable, its fixed text. */
export function reservedResponseOf(code: ReservedCode): Response {
  const { committed, message } = reservedFaults[code];
  return faultResponseOf({ code, committed, retryable: false, message });
}

function jsonResponseOf(status: number, envelope: unknown): Response {
  const headers = { 'content-type': jsonContentType };
  return new Response(JSON.stringify(envelope), { status, headers });
}
