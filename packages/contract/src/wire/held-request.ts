/** A `Request` that follows a signal, and the release that stops holding it from that signal. */
export type HeldRequest = {
  readonly request: Request;
  /** Stops holding `request` from its signal; every holder calls it once the signal can no longer matter, or the `Request` is kept for good. */
  readonly release: () => void;
};

/** What a held `Request` is built with: a signal to follow, and `duplex` for a streamed body. */
type HeldInit = RequestInit & { readonly signal: AbortSignal; readonly duplex?: 'half' };

/**
 * A `Request` built on `init.signal` and held from it until that signal aborts or `release` runs, so
 * code that keeps only `request.signal` still sees it abort: undici's `Request` follows its signal
 * only while the `Request` itself is reachable.
 */
export function heldRequestOf(input: Request | URL | string, init: HeldInit): HeldRequest {
  const request = new Request(input, init);
  const hold = () => request;
  init.signal.addEventListener('abort', hold, { once: true });
  return { request, release: () => init.signal.removeEventListener('abort', hold) };
}
