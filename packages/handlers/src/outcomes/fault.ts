import type { Committed } from '@casitafeliz/loom-contract/internal';

/** A technical failure no Endpoint, Guard or Message declares, as a Handler builds it and a direct call returns it. */
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
export function fault({
  committed,
  retryable,
  message,
  cause,
}: {
  readonly committed: Committed;
  readonly retryable: boolean;
  readonly message?: string | undefined;
  readonly cause?: unknown;
}): Fault {
  const built: Fault = { kind: 'fault', committed, retryable, message: message ?? internalError };
  return cause === undefined ? built : { ...built, cause };
}

/** What anything a Handler throws becomes: nothing says the same request could succeed later. */
export function thrownFault(cause: unknown): Fault {
  return fault({ committed: 'unknown', retryable: false, cause });
}
