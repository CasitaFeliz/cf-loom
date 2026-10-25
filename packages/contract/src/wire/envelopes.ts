import { isReservedCode, type ReservedCode } from '../declarations/index.ts';
import { ownOf } from '../written/index.ts';
import { type BodyMessage, receivedBodyOf } from './body.ts';

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
  METHOD_NOT_ALLOWED: {
    status: 405,
    committed: 'no',
    message: 'No Endpoint has this method on this path',
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

/**
 * The Envelope a received body is, read by its fields alone, extra keys ignored; a Fault's code
 * that is not reserved is dropped, since a new one only comes with a cf-loom major. None otherwise.
 */
export function envelopeOf(received: unknown): RejectionEnvelope | FaultEnvelope | undefined {
  const rejection = ownOf(received, 'rejection');
  if (isRejectionShape(rejection)) {
    return rejectionEnvelopeOf(rejection);
  }
  const fault = travelingFaultOf(ownOf(received, 'fault'));
  return fault === undefined ? undefined : faultEnvelopeOf(fault);
}

/**
 * The Fault a received value is, read by its fields alone; a code that is not reserved is dropped.
 * None when it is no Fault, which a Caller then does not read as one.
 */
export function travelingFaultOf(received: unknown): TravelingFault | undefined {
  if (!isFaultShape(received)) {
    return undefined;
  }
  const { committed, retryable, message } = received;
  const code = isReservedCode(received.code) ? received.code : undefined;
  return code === undefined
    ? { committed, retryable, message }
    : { code, committed, retryable, message };
}

type RejectionFields = {
  readonly code: string;
  readonly message: string;
  readonly body?: unknown;
};

type FaultFields = Omit<TravelingFault, 'code'> & { readonly code?: unknown };

function isRejectionShape(value: unknown): value is RejectionFields {
  return typeof ownOf(value, 'code') === 'string' && typeof ownOf(value, 'message') === 'string';
}

function isFaultShape(value: unknown): value is FaultFields {
  const committed: unknown = ownOf(value, 'committed');
  const isCommitted = committedValues.some((known) => known === committed);
  return (
    isCommitted &&
    typeof ownOf(value, 'retryable') === 'boolean' &&
    typeof ownOf(value, 'message') === 'string'
  );
}

/** What a Caller reads of a body that may be an Envelope: the Envelope, none, or a failed stream. */
export type ReceivedEnvelope =
  | { readonly kind: 'envelope'; readonly envelope: RejectionEnvelope | FaultEnvelope }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly error: unknown };

/** The Envelope a response's body is, read only when its content type is JSON. */
export async function receivedEnvelopeOf(message: BodyMessage): Promise<ReceivedEnvelope> {
  const body = await receivedBodyOf(message);
  switch (body.kind) {
    case 'unreadable':
      return { kind: 'unreadable', error: body.error };
    case 'malformed':
      return { kind: 'none' };
    case 'value': {
      const envelope = envelopeOf(body.value);
      return envelope === undefined ? { kind: 'none' } : { kind: 'envelope', envelope };
    }
  }
}
