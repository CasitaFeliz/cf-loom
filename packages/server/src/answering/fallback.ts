import { faultResponseOf } from '@cf-loom/contract/internal';
import { faultLineOf, logOf, thrownFault } from '@cf-loom/handlers/internal';
import type { Http } from './serve.ts';

/**
 * What an `Http` answers, or the internal Fault when it rejects, logged on the line given, so no
 * rejection escapes.
 */
export async function answeredOf(
  http: Http,
  request: Request,
  rejected: string,
): Promise<Response> {
  try {
    return await http(request);
  } catch (e) {
    console.error(...logOf(rejected, e));
    return faultResponseOf(thrownFault(e));
  }
}

/** What the fallback answers a request `serve` hands it, or the internal Fault when it rejects. */
export function fallbackAnswerOf(fallback: Http, request: Request): Promise<Response> {
  return answeredOf(fallback, request, faultLineOf('serve', { message: 'the fallback rejected' }));
}
