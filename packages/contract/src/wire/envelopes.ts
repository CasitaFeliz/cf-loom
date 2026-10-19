import type { ReservedCode } from '../declarations/index.ts';

/** Whether the change was committed, as values, so a Fault is told by them. */
export const committedValues = ['no', 'yes', 'unknown'] as const;

/** Whether the change was committed, which alone decides whether retrying is safe. */
export type Committed = (typeof committedValues)[number];

/** The one text a Fault says by default, so no internal detail reaches a Caller. */
export const internalError = 'Internal error';

/** How a reserved code travels: its status, whether the change was committed, and its fixed text. */
type ReservedFault = {
  readonly status: number;
  readonly committed: Committed;
  readonly message: string;
};

/**
 * The codes cf-loom answers outside the Contract, as Over HTTP lists them; a text carries nothing
 * received. `INVALID_OUTCOME`'s `committed` is `serve`'s: the Outcome may have been committed
 * before it broke the Contract, while the client's depends on what failed.
 */
export const reservedFaults = {
  // biome-ignore lint/style/useNamingConvention: a reserved code, as it travels
  RETIRED: { status: 410, committed: 'no', message: 'The Endpoint is retired' },
  // biome-ignore lint/style/useNamingConvention: a reserved code, as it travels
  NO_SUCH_ENDPOINT: {
    status: 404,
    committed: 'no',
    message: 'No Endpoint has this method and path',
  },
  // biome-ignore lint/style/useNamingConvention: a reserved code, as it travels
  BODY_TOO_LARGE: { status: 413, committed: 'no', message: 'The body is too large' },
  // biome-ignore lint/style/useNamingConvention: a reserved code, as it travels
  INVALID_OUTCOME: {
    status: 500,
    committed: 'unknown',
    message: 'The Outcome broke the Contract',
  },
} as const satisfies Readonly<Record<ReservedCode, ReservedFault>>;

/** A Rejection's Envelope, as it travels over HTTP. */
export type RejectionEnvelope = {
  readonly rejection: { readonly code: string; readonly message: string; readonly body?: unknown };
};

/** A Fault's Envelope, as it travels over HTTP, with a code only when it is a reserved one. */
export type FaultEnvelope = {
  readonly fault: {
    readonly code?: ReservedCode;
    readonly committed: Committed;
    readonly retryable: boolean;
    readonly message: string;
  };
};

/** A Fault as the wire carries it: what travels of it, never its `cause`. */
export type TravelingFault = FaultEnvelope['fault'];

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
export function faultEnvelopeOf(fault: TravelingFault): FaultEnvelope {
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
