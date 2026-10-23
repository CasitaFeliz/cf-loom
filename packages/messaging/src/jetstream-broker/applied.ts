import { JetStreamApiError } from '@nats-io/jetstream';

/** What became of one stream or durable consumer of the plan: applied, or refused with the reason and, when NATS's client failed, its error. */
export type Applied =
  | { readonly kind: 'applied' }
  | { readonly kind: 'refused'; readonly message: string; readonly cause?: unknown };

/** Names what the NATS client failed to apply, with its error as the cause, so a failure says which stream or durable consumer it was about. */
export function refusedBy(what: string, error: unknown): Applied {
  const reason = error instanceof Error ? error.message : String(error);
  return { kind: 'refused', message: `${what} could not be applied: ${reason}`, cause: error };
}

/** Whether the NATS client failed because the server answered with this API error code, which is how it tells what does not exist. */
export function isApiError(error: unknown, code: number): boolean {
  return error instanceof JetStreamApiError && error.code === code;
}
