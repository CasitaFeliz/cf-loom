import type { Committed } from '@cf-loom/contract';
import { internalError } from '@cf-loom/contract/internal';

/** What every Fault carries: whether the change was committed, its message and its `cause`. */
type FaultBase = {
  readonly kind: 'fault';
  readonly committed: Committed;
  readonly message: string;
  readonly cause?: unknown;
};

/**
 * A technical failure no Endpoint, Guard or Message declares, as a Handler builds it and a direct
 * call returns it; a retryable one may say, in whole seconds, when to retry, and one that is not
 * takes no `retryAfter`.
 */
export type Fault =
  | (FaultBase & { readonly retryable: true; readonly retryAfter?: number })
  | (FaultBase & { readonly retryable: false; readonly retryAfter?: never });

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
): Extract<Fault, { readonly retryable: true }> & { readonly retryAfter: number };
/**
 * A Fault the Handler knows better than `Internal error`: whether the change was committed and
 * whether retrying is worth it.
 */
export function fault(
  given: FaultGiven & { readonly retryAfter?: never },
): Fault & { readonly retryAfter?: never };
export function fault({
  committed,
  retryable,
  message,
  cause,
  retryAfter,
}: FaultGiven & { readonly retryAfter?: number }): Fault {
  const problem = retryAfterProblemOf({ retryable, retryAfter });
  if (problem !== undefined) {
    throw new Error(`fault(): ${problem}`);
  }
  const built: Fault = { kind: 'fault', committed, retryable, message: message ?? internalError };
  const caused = cause === undefined ? built : { ...built, cause };
  return retryAfter === undefined || !caused.retryable ? caused : { ...caused, retryAfter };
}

/**
 * Why a Fault's `retryAfter` cannot be sent as `Retry-After`, or none: it is a whole number of
 * seconds from 0, on a retryable Fault only.
 */
export function retryAfterProblemOf({
  retryable,
  retryAfter,
}: {
  readonly retryable: boolean;
  readonly retryAfter?: unknown;
}): string | undefined {
  if (retryAfter === undefined) {
    return undefined;
  }
  if (typeof retryAfter !== 'number' || !Number.isSafeInteger(retryAfter) || retryAfter < 0) {
    const named = typeof retryAfter === 'string' ? JSON.stringify(retryAfter) : String(retryAfter);
    return `retryAfter is no whole number of seconds from 0: got ${named}`;
  }
  return retryable ? undefined : 'retryAfter is given only to a retryable Fault';
}

/** What anything a Handler throws becomes: nothing says the same request could succeed later. */
export function thrownFault(cause: unknown): Fault {
  return fault({ committed: 'unknown', retryable: false, cause });
}
