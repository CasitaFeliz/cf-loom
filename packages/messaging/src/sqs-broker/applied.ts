/** What became of one stream or Durable consumer of the plan: applied, or refused with the reason and, when the AWS client failed, its error. */
export type Applied =
  | { readonly kind: 'applied' }
  | { readonly kind: 'refused'; readonly message: string; readonly cause?: unknown };

/** Names what the AWS client failed to apply, with its error as the cause, so a failure says which stream or Durable consumer it was about. */
export function refusedBy(what: string, error: unknown): Applied {
  const reason = error instanceof Error ? error.message : String(error);
  return { kind: 'refused', message: `${what} could not be applied: ${reason}`, cause: error };
}

/** Whether the AWS client failed with this error, which is how it tells what does not exist; by the error's name, since a second copy of the SDK in the tree makes `instanceof` miss. */
export function isAwsError(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}
