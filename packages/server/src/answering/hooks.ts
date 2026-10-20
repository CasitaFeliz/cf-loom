import type { Fault, Issue } from '@cf-loom/handlers';
import { faultLogOf, issueLineOf } from '@cf-loom/handlers/internal';

/**
 * A Fault the Service's side produced, which `onServiceFault` receives, naming the Endpoint and,
 * when a GuardHandler produced it, the Guard: one its Handler returned, threw or answered with no
 * Outcome, an Outcome that broke the Contract, or a Context or Qualifier `serve` built that broke
 * it, the runtime's own bug.
 */
export type ServedFault = { readonly endpoint: string; readonly guard?: string } & (
  | { readonly kind: 'returned'; readonly fault: Fault }
  | { readonly kind: 'thrown'; readonly fault: Fault }
  | { readonly kind: 'invalid-outcome'; readonly issues: readonly Issue[] }
  | { readonly kind: 'runtime-bug'; readonly issues: readonly Issue[] }
);

/** Which Handler a Fault came from: the Endpoint's, or the Guard's it names. */
export type FaultedBy = Pick<ServedFault, 'endpoint' | 'guard'>;

/** One request answered: which Endpoint, with what status and kind, and how long it took. */
export type AnsweredRequest = {
  readonly endpoint?: string;
  readonly status: number;
  readonly kind: 'success' | 'rejection' | 'fault';
  readonly durationMs: number;
};

/** Hands a Service's Fault to its hook, or to the console without one. */
export function reportServedFault(
  servedFault: ServedFault,
  onServiceFault: ((fault: ServedFault) => void) | undefined,
): void {
  if (onServiceFault !== undefined) {
    onServiceFault(servedFault);
    return;
  }
  logServedFault(servedFault);
}

/** A Service's Fault on the console: each Issue's part, path, code and message, or the Fault and its cause. */
function logServedFault(servedFault: ServedFault): void {
  const where =
    servedFault.guard === undefined
      ? servedFault.endpoint
      : `${servedFault.endpoint} ${servedFault.guard}`;
  switch (servedFault.kind) {
    case 'returned':
    case 'thrown':
      console.error(...faultLogOf(where, servedFault.fault));
      return;
    case 'invalid-outcome':
    case 'runtime-bug':
      for (const issue of servedFault.issues) {
        console.error(issueLineOf(where, issue));
      }
  }
}
