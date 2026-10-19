import {
  faultEnvelopeOf,
  faultStatusOf,
  jsonContentType,
  rejectionEnvelopeOf,
  type TravellingFault,
} from '@casitafeliz/loom-contract/internal';

/** A Success as the run resolved it: its declared status, and its headers and body when declared. */
export type ResolvedSuccess = {
  readonly status: number;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
};

/** A Rejection as the run resolved it: its code, status and message, and its body when it has one. */
export type ResolvedRejection = {
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly body?: unknown;
};

/** The response of a Success: its status, its declared headers as text, and its body as JSON when it has one. */
export function successResponseOf(success: ResolvedSuccess): Response {
  const headers = new Headers();
  for (const [name, value] of Object.entries(success.headers ?? {})) {
    if (value !== undefined) {
      headers.set(name, String(value));
    }
  }
  if (success.body === undefined) {
    return new Response(null, { status: success.status, headers });
  }
  headers.set('content-type', jsonContentType);
  return new Response(JSON.stringify(success.body), { status: success.status, headers });
}

/** The response of a Rejection: its status and its envelope. */
export function rejectionResponseOf(rejection: ResolvedRejection): Response {
  return jsonResponseOf(rejection.status, rejectionEnvelopeOf(rejection));
}

/** The response of a Fault: the status it travels with and its envelope, never its `cause`. */
export function faultResponseOf(fault: TravellingFault): Response {
  return jsonResponseOf(faultStatusOf(fault), faultEnvelopeOf(fault));
}

function jsonResponseOf(status: number, envelope: unknown): Response {
  const headers = { 'content-type': jsonContentType };
  return new Response(JSON.stringify(envelope), { status, headers });
}
