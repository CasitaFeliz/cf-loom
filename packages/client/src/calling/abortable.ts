/**
 * What work started now gives, or the signal's reason, as `fetch` rejects with it, once the signal
 * is aborted first; a signal already aborted starts no work, and one aborted by the start wins.
 */
export function abortableOf<Value>(
  start: () => Value | PromiseLike<Value>,
  signal: AbortSignal,
): Promise<Value> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  const aborted = Promise.withResolvers<never>();
  const abort = () => aborted.reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const started = new Promise<Value>((resolve) => resolve(start()));
  const settled = Promise.race([aborted.promise, started]);
  return settled.finally(() => signal.removeEventListener('abort', abort));
}
