import { type ReservedCode, reservedCodes } from '../declarations/index.ts';
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

/**
 * The Envelope a received body is, read by its fields alone, extra keys ignored; a Fault's code
 * that is not reserved is dropped, since a new one only comes with a cf-loom major. None otherwise.
 */
export function envelopeOf(received: unknown): RejectionEnvelope | FaultEnvelope | undefined {
  const rejection = fieldOf(received, 'rejection');
  if (isRejectionShape(rejection)) {
    return rejectionEnvelopeOf(rejection);
  }
  const fault = fieldOf(received, 'fault');
  if (isFaultShape(fault)) {
    const { committed, retryable, message } = fault;
    const code = reservedCodeOf(fault.code);
    return faultEnvelopeOf(
      code === undefined
        ? { committed, retryable, message }
        : { code, committed, retryable, message },
    );
  }
  return undefined;
}

type RejectionFields = {
  readonly code: string;
  readonly message: string;
  readonly body?: unknown;
};

type FaultFields = Omit<TravelingFault, 'code'> & { readonly code?: unknown };

function isRejectionShape(value: unknown): value is RejectionFields {
  return (
    typeof fieldOf(value, 'code') === 'string' && typeof fieldOf(value, 'message') === 'string'
  );
}

function isFaultShape(value: unknown): value is FaultFields {
  const committed: unknown = fieldOf(value, 'committed');
  const isCommitted = committedValues.some((known) => known === committed);
  return (
    isCommitted &&
    typeof fieldOf(value, 'retryable') === 'boolean' &&
    typeof fieldOf(value, 'message') === 'string'
  );
}

function reservedCodeOf(code: unknown): ReservedCode | undefined {
  return reservedCodes.find((reserved) => reserved === code);
}

/** A field of a received JSON object; none for anything that is no object, a list included. */
function fieldOf(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.hasOwn(value, field) ? Reflect.get(value, field) : undefined;
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
