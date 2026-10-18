/** Whether the change was committed, which alone decides whether retrying is safe. */
export type Committed = 'no' | 'yes' | 'unknown';

/** A technical failure no Element declares, as a Handler builds it and a direct call returns it. */
export type Fault = {
  readonly kind: 'fault';
  readonly committed: Committed;
  readonly retryable: boolean;
  readonly message: string;
  readonly cause?: unknown;
};

/** The one text a Fault says by default, so no internal detail reaches a Caller. */
const internalError = 'Internal error';

/**
 * A Fault the Handler knows better than `Internal error`: whether the change was committed and
 * whether retrying is worth it.
 */
export function fault(given: {
  readonly committed: Committed;
  readonly retryable: boolean;
  readonly message?: string;
  readonly cause?: unknown;
}): Fault {
  return { kind: 'fault', message: internalError, ...given };
}

/** What anything a Handler throws becomes: nothing says the same request could succeed later. */
export function thrownFault(cause: unknown): Fault {
  return fault({ committed: 'unknown', retryable: false, cause });
}
