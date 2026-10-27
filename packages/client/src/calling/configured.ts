import { ownOf } from '@cf-loom/contract/internal';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { notSentFaultOf, type ReceivedFault } from '../inference/index.ts';
import { abortableOf } from './abortable.ts';
import type { CallOptions } from './client-types.ts';

/** The headers given to `client()`, each a value or a function called per request. */
export type ConfiguredHeaders = Readonly<Record<string, unknown>>;

/** What a call gives the headers of `client()` to complete: those it passes, and its signal. */
export type Passing = {
  readonly passed: unknown;
  readonly signal: AbortSignal | undefined;
};

/** A call's headers, or the Fault of its signal, aborted before they were all there. */
export type Headed =
  | { readonly kind: 'headed'; readonly headers: unknown }
  | { readonly kind: 'not-sent'; readonly fault: ReceivedFault };

/**
 * A call's headers with those given to `client()` that its Endpoint declares and the call did not
 * pass, a function among them called now with the call's signal and raced against it; what it
 * throws reaches the Caller, unless the signal was aborted by then.
 */
export async function withConfiguredHeaders(
  called: CalledEndpoint,
  configured: ConfiguredHeaders,
  { passed, signal }: Passing,
): Promise<Headed> {
  const missing = Object.entries(configured).filter(
    ([name]) => called.inputHeaderNames.has(name) && ownOf(passed, name) === undefined,
  );
  if (missing.length === 0) {
    return { kind: 'headed', headers: passed };
  }
  const headers: Record<string, unknown> = isFields(passed) ? { ...passed } : {};
  try {
    for (const [name, value] of missing) {
      headers[name] = isHeaderFunction(value) ? await headerValueOf(value, signal) : value;
    }
  } catch (error) {
    if (signal?.aborted) {
      return { kind: 'not-sent', fault: notSentFaultOf(signal) };
    }
    throw error;
  }
  return { kind: 'headed', headers };
}

/** A header function's value, the call's options given and the wait cut short by the signal. */
async function headerValueOf(
  header: (call: CallOptions) => unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (signal === undefined) {
    return await header({});
  }
  return await abortableOf(Promise.resolve(header({ signal })), signal);
}

function isHeaderFunction(value: unknown): value is (call: CallOptions) => unknown {
  return typeof value === 'function';
}

function isFields(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
