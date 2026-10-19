import { type ReservedCode, reservedFaults } from '@casitafeliz/loom-contract/internal';
import { faultResponseOf } from './outcome.ts';

/** The fixed text of a reserved code, which carries nothing received. */
function messageOf(code: ReservedCode): string {
  switch (code) {
    case 'RETIRED':
      return 'The Endpoint is retired';
    case 'NO_SUCH_ENDPOINT':
      return 'No Endpoint has this method and path';
    case 'BODY_TOO_LARGE':
      return 'The body is too large';
    case 'INVALID_OUTCOME':
      return 'The Outcome broke the Contract';
  }
}

/** The response of a reserved code: its status, its `committed`, never retryable, its fixed text. */
export function reservedResponseOf(code: ReservedCode): Response {
  const { committed } = reservedFaults[code];
  return faultResponseOf({ code, committed, retryable: false, message: messageOf(code) });
}

/**
 * The response of the runtime's own bug, a Context or Qualifier `serve` built that broke the
 * Contract: not committed, since the run refused it before the implementation ran.
 */
export function runtimeBugResponse(): Response {
  return faultResponseOf({ committed: 'no', retryable: false, message: 'Internal error' });
}
