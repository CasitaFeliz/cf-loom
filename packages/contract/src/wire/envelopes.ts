import type { IssueCode } from '../declarations/index.ts';
import { type InputPart, inOf } from '../validation/index.ts';

/** Whether the change was committed, as values, so a Fault is told by them. */
export const committedValues = ['no', 'yes', 'unknown'] as const;

/** Whether the change was committed, which alone decides whether retrying is safe. */
export type Committed = (typeof committedValues)[number];

/** The codes cf-loom answers outside the Contract, as a Fault. */
export type ReservedCode = 'RETIRED' | 'NO_SUCH_ENDPOINT' | 'BODY_TOO_LARGE' | 'INVALID_OUTCOME';

/** The codes cf-loom answers outside the Contract, each with its status and `committed`, as Over HTTP lists them. */
export const reservedFaults: Readonly<
  Record<ReservedCode, { readonly status: number; readonly committed: Committed }>
> = {
  RETIRED: { status: 410, committed: 'no' },
  NO_SUCH_ENDPOINT: { status: 404, committed: 'no' },
  BODY_TOO_LARGE: { status: 413, committed: 'no' },
  INVALID_OUTCOME: { status: 500, committed: 'unknown' },
};

/** A Rejection as it travels over HTTP. */
export type RejectionEnvelope = {
  readonly rejection: { readonly code: string; readonly message: string; readonly body?: unknown };
};

/** A Fault as it travels over HTTP, with a code only when it is a reserved one. */
export type FaultEnvelope = {
  readonly fault: {
    readonly code?: ReservedCode;
    readonly committed: Committed;
    readonly retryable: boolean;
    readonly message: string;
  };
};

/** A Fault as the wire carries it: what travels of it, never its `cause`. */
export type TravellingFault = FaultEnvelope['fault'];

/** A Rejection as it travels: `{ rejection: { code, message, body } }`, no `body` key without one. */
export function rejectionEnvelopeOf(rejection: {
  readonly code: string;
  readonly message: string;
  readonly body?: unknown;
}): RejectionEnvelope {
  const { code, message, body } = rejection;
  return { rejection: body === undefined ? { code, message } : { code, message, body } };
}

/** A Fault as it travels: `{ fault: { code?, committed, retryable, message } }`. */
export function faultEnvelopeOf(fault: TravellingFault): FaultEnvelope {
  const { code, committed, retryable, message } = fault;
  return {
    fault:
      code === undefined
        ? { committed, retryable, message }
        : { code, committed, retryable, message },
  };
}

/** The status a Fault travels with: its reserved code's, else 503 when retryable and 500 otherwise. */
export function faultStatusOf(fault: {
  readonly code?: ReservedCode;
  readonly retryable: boolean;
}): number {
  if (fault.code !== undefined) {
    return reservedFaults[fault.code].status;
  }
  return fault.retryable ? 503 : 500;
}

/** One way the request broke the part of the Contract the Caller sent; never the received value. */
export type InputIssue = {
  readonly part: InputPart;
  readonly path: readonly (string | number)[];
  readonly code: IssueCode;
  readonly message: string;
};

/** The body of the invalid-input Rejection, cf-loom's own: each Issue with the part of the request it read. */
export function invalidInputBodyOf(issues: readonly InputIssue[]): {
  readonly issues: readonly {
    readonly in: ReturnType<typeof inOf>;
    readonly path: readonly (string | number)[];
    readonly code: IssueCode;
    readonly message: string;
  }[];
} {
  return {
    issues: issues.map(({ part, path, code, message }) => ({
      in: inOf(part),
      path,
      code,
      message,
    })),
  };
}
