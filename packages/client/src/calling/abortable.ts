/**
 * What a wait gives, or the signal's reason, as `fetch` rejects with it, once the signal is aborted
 * first; a signal already aborted wins at once, since its `abort` event does not fire again.
 */
export function abortableOf<Value>(waited: Promise<Value>, signal: AbortSignal): Promise<Value> {
  const aborted = Promise.withResolvers<never>();
  const abort = () => aborted.reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) {
    abort();
  }
  const settled = Promise.race([aborted.promise, waited]);
  return settled.finally(() => signal.removeEventListener('abort', abort));
}
