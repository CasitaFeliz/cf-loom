import { type Committed, internalError } from '@cf-loom/contract/internal';

/**
 * A technical failure no Endpoint, Guard or Message declares, as a Handler builds it and a direct
 * call returns it; a retryable one may say, in whole seconds, when to retry.
 */
export type Fault = {
  readonly kind: 'fault';
  readonly committed: Committed;
  readonly retryable: boolean;
  readonly message: string;
  readonly cause?: unknown;
  readonly retryAfter?: number;
};

/** What every Fault a Handler builds is given: whether the change was committed and whether retrying is worth it. */
type FaultGiven = {
  readonly committed: Committed;
  readonly retryable: boolean;
  readonly message?: string | undefined;
  readonly cause?: unknown;
};

/** A retryable Fault that says, in whole seconds from 0, when to retry, which `serve` sends as `Retry-After`. */
export function fault(
  given: FaultGiven & { readonly retryable: true; readonly retryAfter: number },
): Fault & { readonly retryAfter: number };
/**
 * A Fault the Handler knows better than `Internal error`: whether the change was committed and
 * whether retrying is worth it.
 */
export function fault(given: FaultGiven): Fault & { readonly retryAfter?: never };
export function fault({
  committed,
  retryable,
  message,
  cause,
  retryAfter,
}: FaultGiven & { readonly retryAfter?: number }): Fault {
  const built: Fault = { kind: 'fault', committed, retryable, message: message ?? internalError };
  const caused = cause === undefined ? built : { ...built, cause };
  return retryAfter === undefined
    ? caused
    : { ...caused, retryAfter: checkedRetryAfter(retryAfter) };
}

/** A `retryAfter` that is a whole number of seconds from 0; any other is the Handler's bug. */
function checkedRetryAfter(retryAfter: number): number {
  if (Number.isSafeInteger(retryAfter) && retryAfter >= 0) {
    return retryAfter;
  }
  throw new Error(
    `fault() takes retryAfter as a whole number of seconds from 0: got ${retryAfter}`,
  );
}

/** What anything a Handler throws becomes: nothing says the same request could succeed later. */
export function thrownFault(cause: unknown): Fault {
  return fault({ committed: 'unknown', retryable: false, cause });
}
