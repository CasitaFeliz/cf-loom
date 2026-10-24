import type { Endpoint, Method } from '@cf-loom/contract';
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

/**
 * One request answered, for metrics and tracing: its method, and the Endpoint it matched with that
 * Endpoint's path as declared, or neither when none matched.
 */
export type AnsweredRequest = {
  /** The HTTP status sent. */
  readonly status: number;
  /** Whether a Success, a Rejection or a Fault was sent. */
  readonly kind: 'success' | 'rejection' | 'fault';
  /** How long the request took, in milliseconds. */
  readonly durationMs: number;
} & (
  | {
      /** The matched Endpoint's method, which the request's matched exactly. */
      readonly method: Method;
      /** The name of the Endpoint the request matched. */
      readonly endpoint: string;
      /** The Endpoint's path as declared, its params as `:name`, such as `/orders/:orderId`. */
      readonly path: string;
    }
  | {
      /** The request's method as the web-standard `Request` holds it, whatever it is. */
      readonly method: string;
      readonly endpoint?: never;
      readonly path?: never;
    }
);

/** The record `onOutcome` receives: the request's method, and the matched Endpoint's name and path. */
export function answeredRequestOf(
  method: string,
  endpoint: Endpoint | undefined,
  sent: Pick<AnsweredRequest, 'status' | 'kind' | 'durationMs'>,
): AnsweredRequest {
  if (endpoint === undefined) {
    return { method, ...sent };
  }
  return { method: endpoint.method, endpoint: endpoint.name, path: endpoint.path, ...sent };
}

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
