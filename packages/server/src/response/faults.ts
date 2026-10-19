import {
  internalError,
  type ReservedCode,
  reservedFaults,
} from '@casitafeliz/loom-contract/internal';
import { faultResponseOf } from './outcome.ts';

/** The response of a reserved code: its status, its `committed`, never retryable, its fixed text. */
export function reservedResponseOf(code: ReservedCode): Response {
  const { committed, message } = reservedFaults[code];
  return faultResponseOf({ code, committed, retryable: false, message });
}

/**
 * The response of the runtime's own bug, a Context or Qualifier `serve` built that broke the
 * Contract: not committed, since the run refused it before the implementation ran.
 */
export function runtimeBugResponse(): Response {
  return faultResponseOf({ committed: 'no', retryable: false, message: internalError });
}
