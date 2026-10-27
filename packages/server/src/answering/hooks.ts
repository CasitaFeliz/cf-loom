import type { Endpoint, Guard, Method } from '@cf-loom/contract';
import { isMethod, issueLineOf } from '@cf-loom/contract/internal';
import type { Issue } from '@cf-loom/handlers';
import {
  failureCauseOf,
  failureLineOf,
  type HandlerFailure,
  type HandlerFaultBase,
  hookFailureOf,
  logOf,
} from '@cf-loom/handlers/internal';

/**
 * A Fault the Service's side produced, which `onServiceFault` receives: the Endpoint the request
 * matched as `declaration`, with its name as `identity`, also when a Guard's Handler produced it,
 * which `guard` then names; then how it failed.
 */
export type ServedFault = HandlerFaultBase<Endpoint> & { readonly guard?: Guard } & (
    | HandlerFailure
    | { readonly kind: 'invalid-outcome'; readonly issues: readonly Issue[] }
    | { readonly kind: 'runtime-bug'; readonly issues: readonly Issue[] }
  );

/** Which Handler a Fault came from: the Endpoint's, or the Guard's it names. */
export type FaultedBy = Pick<ServedFault, 'declaration' | 'identity' | 'guard'>;

/**
 * One request answered, for metrics and tracing: its method, and the Endpoint it matched with that
 * Endpoint's path as declared, or neither when none matched.
 */
export type AnsweredRequest = {
  /** The HTTP status sent. */
  readonly status: number;
  /** Whether a Success, a Rejection or a Fault was sent. */
  readonly kind: 'success' | 'rejection' | 'fault';
  /** The code sent: a Rejection's, as the Root resolved it, or a reserved Fault's; none for a Success or a Fault the Service produced. */
  readonly code?: string;
  /** Whether the Caller went away before `serve` had its answer: the request's signal when the record is built. */
  readonly aborted: boolean;
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
      /**
       * The request's method when an Endpoint may declare it, or `HEAD`, else `_OTHER`, so its
       * cardinality is bounded, as OpenTelemetry's `http.request.method` asks.
       */
      readonly method: Method | 'HEAD' | '_OTHER';
      readonly endpoint?: never;
      readonly path?: never;
    }
);

/**
 * The record `onAnswered` receives: the method, and the matched Endpoint's name and path, and
 * whether the request's signal aborted before its answer.
 */
export function answeredRequestOf(
  request: Request,
  endpoint: Endpoint | undefined,
  sent: Pick<AnsweredRequest, 'status' | 'kind' | 'code' | 'durationMs'>,
): AnsweredRequest {
  const answered = { ...sent, aborted: request.signal.aborted };
  if (endpoint === undefined) {
    return { method: recordedMethodOf(request.method), ...answered };
  }
  return { method: endpoint.method, endpoint: endpoint.name, path: endpoint.path, ...answered };
}

/** An unmatched request's method as recorded: one an Endpoint may declare, or `HEAD`, else `_OTHER`. */
function recordedMethodOf(method: string): Method | 'HEAD' | '_OTHER' {
  return isMethod(method) || method === 'HEAD' ? method : '_OTHER';
}

/** A hook of `serve`: it receives what it hears of, and the Request it came from. */
export type ServeHook<Heard> = (heard: Heard, request: Request) => void | Promise<void>;

/** Hands a Service's Fault and its Request to its hook, or the Fault to the console without one; a hook that fails is logged. */
export async function reportServedFault(
  servedFault: ServedFault,
  request: Request,
  onServiceFault: ServeHook<ServedFault> | undefined,
): Promise<void> {
  if (onServiceFault === undefined) {
    logServedFault(servedFault);
    return;
  }
  await hookFailureOf((fault) => onServiceFault(fault, request), servedFault, {
    source: sourceOf(servedFault),
    hook: 'onServiceFault',
  });
}

/** Hands a request's record and the Request to `onAnswered`, if any; one that fails is logged. */
export async function recordAnswered(
  record: AnsweredRequest,
  request: Request,
  onAnswered: ServeHook<AnsweredRequest> | undefined,
): Promise<void> {
  if (onAnswered !== undefined) {
    await hookFailureOf((answered) => onAnswered(answered, request), record, {
      source: record.endpoint ?? 'serve',
      hook: 'onAnswered',
    });
  }
}

/** A Service's Fault on the console: each Issue's part, path, code and message, or the Fault and its cause. */
function logServedFault(servedFault: ServedFault): void {
  const where = sourceOf(servedFault);
  switch (servedFault.kind) {
    case 'returned':
    case 'thrown':
      console.error(...logOf(failureLineOf(where, servedFault), failureCauseOf(servedFault)));
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
