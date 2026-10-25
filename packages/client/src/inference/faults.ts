import type { Committed, Issue, ReservedCode } from '@cf-loom/contract';

/** What a call met instead of an Outcome of its own, as `inferFault` is offered it. */
export type Happened =
  | {
      readonly kind: 'no-connection' | 'connection-lost' | 'connection-failed';
      readonly error: unknown;
    }
  | {
      readonly kind: 'aborted' | 'timeout';
      readonly error: unknown;
      readonly status?: number;
      readonly headers?: Headers;
    }
  | { readonly kind: 'status'; readonly status: number; readonly headers: Headers }
  | {
      readonly kind: 'unreadable-body';
      readonly status: number;
      readonly headers: Headers;
      readonly error: unknown;
    };

/** What a response that arrived left: a status with no Outcome, or a body that failed. */
export type Answered = Extract<Happened, { readonly kind: 'status' | 'unreadable-body' }>;

/** Where a Fault came from: the Provider's Envelope, what the client met instead, or an Outcome that broke the Contract. */
export type FaultSource = 'provider' | Happened['kind'] | 'invalid-outcome';

/** What an inference decides of a Fault: whether it was committed, and whether a retry may succeed. */
export type InferredFault = { readonly committed: Committed; readonly retryable: boolean };

/** An organization's inference, given cf-loom's; `undefined` keeps cf-loom's. */
export type InferFault = (happened: Happened, inferred: InferredFault) => InferredFault | undefined;

/** A Fault as a Caller receives it: the Provider's, or one the client inferred or found. */
export type ReceivedFault = {
  readonly kind: 'fault';
  readonly source: FaultSource;
  readonly committed: Committed;
  readonly retryable: boolean;
  readonly message: string;
  readonly status?: number;
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
