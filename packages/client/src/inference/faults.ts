import type { Committed, Issue, ReservedCode } from '@cf-loom/contract/internal';

/** What happened to a call that answered no Outcome of its own, as `inferFault` is offered it. */
export type Happened = { readonly kind: 'thrown'; readonly error: unknown } | Answered;

/** What happened when a response arrived: a status with no Outcome, or a body that failed. */
export type Answered =
  | { readonly kind: 'status'; readonly status: number; readonly headers: Headers }
  | {
      readonly kind: 'unreadable-body';
      readonly status: number;
      readonly headers: Headers;
      readonly error: unknown;
    };

/** What an inference decides of a Fault: whether it was committed, and whether a retry may succeed. */
export type InferredFault = { readonly committed: Committed; readonly retryable: boolean };

/** An organization's inference, given cf-loom's; `undefined` keeps cf-loom's. */
export type InferFault = (happened: Happened, inferred: InferredFault) => InferredFault | undefined;

/**
 * A Fault as a Caller receives it: what the Provider sent, or what the client inferred or found,
 * with the error `fetch` threw and the Issues of an Outcome that broke the Contract, never its value.
 */
export type ReceivedFault = {
  readonly kind: 'fault';
  readonly committed: Committed;
  readonly retryable: boolean;
  readonly message: string;
  readonly code?: ReservedCode;
  readonly retryAfter?: string;
  readonly cause?: unknown;
  readonly issues?: readonly Issue[];
};

/** A Fault with the response's `Retry-After` header, when it carries one. */
export function withRetryAfter(fault: ReceivedFault, headers: Headers): ReceivedFault {
  const retryAfter = headers.get('retry-after');
  return retryAfter === null ? fault : { ...fault, retryAfter };
}
