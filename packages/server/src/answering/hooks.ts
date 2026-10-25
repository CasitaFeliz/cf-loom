import type { Endpoint, Guard, Method } from '@cf-loom/contract';
import type { Issue } from '@cf-loom/handlers';
import {
  faultLineOf,
  faultLogOf,
  type HandlerFailure,
  type HandlerFaultBase,
  hookThrewLineOf,
  issueLineOf,
  logOf,
} from '@cf-loom/handlers/internal';

/**
 * A Fault the Service's side produced, which `onServiceFault` receives: the Endpoint as `element`
 * with its name as `identity`, the Guard when its GuardHandler produced it, then how it failed.
 */
export type ServedFault = HandlerFaultBase<Endpoint> & { readonly guard?: Guard } & (
    | HandlerFailure
    | { readonly kind: 'invalid-outcome'; readonly issues: readonly Issue[] }
    | { readonly kind: 'runtime-bug'; readonly issues: readonly Issue[] }
  );

/** Which Handler a Fault came from: the Endpoint's, or the Guard's it names. */
export type FaultedBy = Pick<ServedFault, 'element' | 'identity' | 'guard'>;

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

/** Hands a Service's Fault to its hook, or to the console without one; a hook that fails is logged. */
export async function reportServedFault(
  servedFault: ServedFault,
  onServiceFault: ((fault: ServedFault) => void | Promise<void>) | undefined,
): Promise<void> {
  if (onServiceFault === undefined) {
    logServedFault(servedFault);
    return;
  }
  try {
    await onServiceFault(servedFault);
  } catch (e) {
    console.error(...logOf(hookThrewLineOf(sourceOf(servedFault), 'onServiceFault'), e));
  }
}

/** Hands a request's record to `onOutcome`, if any; one that fails is logged. */
export async function recordAnswered(
  record: AnsweredRequest,
  onOutcome: ((request: AnsweredRequest) => void | Promise<void>) | undefined,
): Promise<void> {
  try {
    await onOutcome?.(record);
  } catch (e) {
    console.error(...logOf(hookThrewLineOf(record.endpoint ?? 'serve', 'onOutcome'), e));
  }
}

/** A Service's Fault on the console: each Issue's part, path, code and message, or the Fault and its cause. */
function logServedFault(servedFault: ServedFault): void {
  const where = sourceOf(servedFault);
  switch (servedFault.kind) {
    case 'returned':
      console.error(...faultLogOf(where, servedFault.fault));
      return;
    case 'thrown':
      console.error(
        ...logOf(faultLineOf(where, { message: 'the Handler threw' }), servedFault.cause),
      );
      return;
    case 'invalid-outcome':
    case 'runtime-bug':
      for (const issue of servedFault.issues) {
        console.error(issueLineOf(where, issue));
      }
  }
}

/** What names a Service's Fault in a line: the Endpoint's name, and the Guard's when it has one. */
function sourceOf({ identity, guard }: FaultedBy): string {
  return guard === undefined ? identity : `${identity} ${guard.name}`;
}
