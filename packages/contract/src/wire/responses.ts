import type { ReservedCode } from '../declarations/index.ts';
import { jsonContentType } from './content-type.ts';
import {
  faultEnvelopeOf,
  rejectionEnvelopeOf,
  reservedFaults,
  type TravelingFault,
} from './envelopes.ts';
import { headerTextsOf } from './header-text.ts';

/** A Success as it is sent: its declared status, its declared headers as checked, and its body. */
export type SentSuccess = {
  readonly status: number;
  readonly headers?: Readonly<Record<string, unknown>> | undefined;
  readonly body?: unknown;
};

/** What of a Fault the Service produced travels: never a code, which only the runtime's reserved Faults carry. */
export type SentFault = Omit<TravelingFault, 'code'>;

/** A Rejection as it is sent: its code, status and message resolved, its declared headers as checked, and its body when it has one. */
export type SentRejection = {
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly headers?: Readonly<Record<string, unknown>> | undefined;
  readonly body?: unknown;
};

/**
 * The response of a Success checked before it is sent: each header as its text, one left
 * `undefined` unsent, and its body as JSON; a header that cannot travel is a bug of that check, thrown.
 */
export function successResponseOf(success: SentSuccess): Response {
  const headers = new Headers();
  for (const [name, text] of sentHeaderTextsOf('success.headers', success.headers)) {
    headers.set(name, text);
  }
  if (success.body === undefined) {
    return new Response(null, { status: success.status, headers });
  }
  headers.set('content-type', jsonContentType);
  return new Response(JSON.stringify(success.body), { status: success.status, headers });
}

/**
 * The response of a Rejection checked before it is sent: its status, each declared header as its
 * text, and its Envelope; a header that cannot travel is a bug of that check, thrown.
 */
export function rejectionResponseOf(rejection: SentRejection): Response {
  const response = jsonResponseOf(rejection.status, rejectionEnvelopeOf(rejection));
  for (const [name, text] of sentHeaderTextsOf('headers', rejection.headers)) {
    response.headers.set(name, text);
  }
  return response;
}

/**
 * The response of a Fault the Service produced: only its `committed`, `retryable` and `message`
 * travel, and its `retryAfter` as `Retry-After` when it has one.
 */
export function faultResponseOf({
  committed,
  retryable,
  message,
  retryAfter,
}: SentFault & { readonly retryAfter?: number | undefined }): Response {
  const envelope = faultEnvelopeOf({ committed, retryable, message });
  const response = jsonResponseOf(faultStatusOf({ retryable }), envelope);
  if (retryAfter !== undefined) {
    response.headers.set('retry-after', String(retryAfter));
  }
  return response;
}

/** What a Fault is given to say when to retry: only a retryable one, in whole seconds from 0. */
export type RetryAfterGiven =
  | { readonly retryable: true; readonly retryAfter?: number }
  | { readonly retryable: false; readonly retryAfter?: never };

/**
 * Why a Fault's `retryAfter` cannot be sent as `Retry-After`, or none: it is a whole number of
 * seconds from 0, on a retryable Fault only.
 */
export function retryAfterProblemOf({
  retryable,
  retryAfter,
}: {
  readonly retryable: boolean;
  readonly retryAfter?: unknown;
}): string | undefined {
  if (retryAfter === undefined) {
    return undefined;
  }
  if (typeof retryAfter !== 'number' || !Number.isSafeInteger(retryAfter) || retryAfter < 0) {
    const named = typeof retryAfter === 'string' ? JSON.stringify(retryAfter) : String(retryAfter);
    return `retryAfter is no whole number of seconds from 0: got ${named}`;
  }
  return retryable ? undefined : 'retryAfter is given only to a retryable Fault';
}

/** The status a Fault the Service produced travels with: 503 when retryable, else 500. */
export function faultStatusOf({ retryable }: Pick<SentFault, 'retryable'>): number {
  return retryable ? 503 : 500;
}

/**
 * The response of a reserved code, the only Fault that travels with one: its status, its
 * `committed`, never retryable, its fixed text.
 */
export function reservedResponseOf(code: ReservedCode): Response {
  const { status, committed, message } = reservedFaults[code];
  return jsonResponseOf(status, faultEnvelopeOf({ code, committed, retryable: false, message }));
}

/** `METHOD_NOT_ALLOWED`'s response, its `Allow` header listing the methods the path takes. */
export function methodNotAllowedResponseOf(allowed: readonly string[]): Response {
  const response = reservedResponseOf('METHOD_NOT_ALLOWED');
  response.headers.set('allow', allowed.join(', '));
  return response;
}

/** The sent part's names in the words of its error: a Success's headers, or a Rejection's. */
const sentNouns = { 'success.headers': 'A Success', headers: 'A Rejection' } as const;

function sentHeaderTextsOf(
  part: keyof typeof sentNouns,
  sent: Readonly<Record<string, unknown>> | undefined,
): readonly (readonly [string, string])[] {
  const headers = headerTextsOf(part, sent);
  if (headers.kind === 'issues') {
    const names = headers.issues.map(({ path }) => path.join('.')).join(', ');
    throw new Error(
      `${sentNouns[part]} header that cannot travel was not checked before it was sent: ${names}`,
    );
  }
  return headers.texts;
}

function jsonResponseOf(status: number, envelope: unknown): Response {
  const headers = { 'content-type': jsonContentType };
  return new Response(JSON.stringify(envelope), { status, headers });
}
