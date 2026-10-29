/** What became of one Stream or Durable consumer of the plan: applied, or refused with the reason and, when the Broker's client failed, its error. */
export type Applied =
  | { readonly kind: 'applied' }
  | { readonly kind: 'refused'; readonly message: string; readonly cause?: unknown };

/** Names what the Broker's client failed to apply, with its error as the cause, so a failure says which Stream or Durable consumer it was about. */
export function refusedBy(what: string, error: unknown): Applied {
  const reason = error instanceof Error ? error.message : String(error);
  return { kind: 'refused', message: `${what} could not be applied: ${reason}`, cause: error };
}
