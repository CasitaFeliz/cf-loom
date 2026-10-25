import { faultResponseOf, internalError } from '@cf-loom/contract/internal';
import { faultLineOf, logOf } from '@cf-loom/handlers/internal';

/** The fetch-style handler `serve` returns: what an adapter connects to its host. */
export type Http = (request: Request) => Promise<Response>;

/**
 * What the fallback answers a request `serve` hands it, or the internal Fault when it rejects,
 * logged, so `serve`'s handler never rejects.
 */
export async function fallbackAnswerOf(fallback: Http, request: Request): Promise<Response> {
  try {
    return await fallback(request);
  } catch (e) {
    console.error(...logOf(faultLineOf('serve', { message: 'the fallback rejected' }), e));
    return faultResponseOf({ committed: 'unknown', retryable: false, message: internalError });
  }
}
