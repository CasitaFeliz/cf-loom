import type * as core from 'zod/v4/core';
import type { JoinedNames, LiteralNames } from './rules.ts';

/** The HTTP methods an Endpoint may declare, as values, so the runtime repeats the type's rule. */
export const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/**
 * The HTTP methods an Endpoint may declare; any other is a type error. `HEAD` is not one: its
 * response has no body, so no Envelope, and only a Success could reach the Caller.
 */
export type Method = (typeof methods)[number];

/** Whether a request's method is one an Endpoint may declare. */
export function isMethod(method: string): method is Method {
  return methods.some((declarable) => declarable === method);
}

/** The statuses a Success may declare, as values, so the runtime repeats the type's rule. */
export const successStatuses = [200, 201, 202, 203, 204] as const;

/** The statuses a Success may declare: 205 and 206 carry semantics cf-loom does not implement. */
export type SuccessStatus = (typeof successStatuses)[number];

/**
 * The request header names no Contract declares: the Fetch standard's forbidden request-header
 * names, which it keeps for the user agent
 * (https://fetch.spec.whatwg.org/#forbidden-request-header), the body's `content-type`,
 * `content-encoding` and `content-range`, and the `deprecation` cf-loom owns. A name starting with
 * one of `reservedRequestHeaderPrefixes` is reserved besides.
 */
const reservedRequestHeaderNames: readonly string[] = [
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'content-type',
  'content-encoding',
  'content-range',
  'deprecation',
];

/** The prefixes the Fetch standard keeps for the user agent: no request header a Contract declares starts with one. */
const reservedRequestHeaderPrefixes: readonly string[] = ['proxy-', 'sec-'];

/**
 * The response header names no Contract declares: the framing and connection headers the host
 * owns, `host`, the body's `content-type`, `content-encoding` and `content-range`, the
 * `deprecation` cf-loom sends, and the Fetch standard's forbidden response-header names, which a
 * browser never exposes to code (https://fetch.spec.whatwg.org/#forbidden-response-header-name).
 */
const reservedResponseHeaderNames: readonly string[] = [
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-connection',
  'upgrade',
  'te',
  'trailer',
  'host',
  'content-type',
  'content-encoding',
  'content-range',
  'deprecation',
  'set-cookie',
  'set-cookie2',
];

/** Whether a lower-case header name is one the user agent or cf-loom owns, so no request part declares it. */
export function isReservedRequestHeaderName(name: string): boolean {
  return (
    reservedRequestHeaderNames.includes(name) ||
    reservedRequestHeaderPrefixes.some((prefix) => name.startsWith(prefix))
  );
}

/** Whether a lower-case header name is one the host or cf-loom owns, or a browser hides, so no response part declares it. */
export function isReservedResponseHeaderName(name: string): boolean {
  return reservedResponseHeaderNames.includes(name);
}

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

type NumberOf<Text> = Text extends `${infer Value extends number}` ? Value : never;

/** The statuses a declared Rejection may have: a business decision is always the Caller's 4xx. */
export type RejectionStatus = NumberOf<`4${Digit}${Digit}`>;

/** The status of the not-implemented Rejection, the one Rejection that is no Caller's 4xx. */
export const notImplementedStatus = 501;

/** Whether a value is a status a declared Rejection may have, as the runtime repeats the type. */
export function isRejectionStatus(status: unknown): status is RejectionStatus {
  return Number.isInteger(status) && typeof status === 'number' && status >= 400 && status <= 499;
}

type UpperCaseHeaderNames<Schema> =
  Schema extends core.$ZodObject<infer Shape>
    ? Exclude<LiteralNames<keyof Shape>, Lowercase<keyof Shape & string>>
    : never;

/** What a headers schema must also satisfy: header names have one spelling, lower-case. */
export type HeaderNamesRule<Schema> = [UpperCaseHeaderNames<Schema>] extends [never]
  ? unknown
  : `Header names are lower-case: ${JoinedNames<UpperCaseHeaderNames<Schema>>}`;
