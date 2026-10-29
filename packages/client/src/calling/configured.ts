import { ownOf } from '@cf-loom/contract/internal';
import type { CalledEndpoint } from '../endpoints/index.ts';
import { isFields } from '../request/index.ts';
import { abortableOf } from './abortable.ts';
import type { CallOptions } from './client-types.ts';

/** The headers given to `client()`, each a value or a function called per request. */
export type ConfiguredHeaders = Readonly<Record<string, unknown>>;

/**
 * A call's headers with those given to `client()` that its Endpoint declares and the call did not
 * pass, a function among them called now with the call's options and raced against its signal; it
 * rejects with what the function throws, or with the signal's reason once it is aborted.
 */
export async function withConfiguredHeaders(
  called: CalledEndpoint,
  configured: ConfiguredHeaders,
  { passed, call }: { readonly passed: unknown; readonly call: CallOptions },
): Promise<unknown> {
  const missing = Object.entries(configured).filter(
    ([name]) => called.inputHeaderNames.has(name) && ownOf(passed, name) === undefined,
  );
  if (missing.length === 0) {
    return passed;
  }
  const headers: Record<string, unknown> = isFields(passed) ? { ...passed } : {};
  for (const [name, value] of missing) {
    headers[name] = isHeaderFunction(value) ? await headerValueOf(value, call) : value;
  }
  return headers;
}

/** A header function's value, never asked for once the signal is aborted and cut short by its abort. */
async function headerValueOf(
  header: (call: CallOptions) => unknown,
  call: CallOptions,
): Promise<unknown> {
  const { signal } = call;
  if (signal === undefined) {
    return await header(call);
  }
  return await abortableOf(() => header(call), signal);
}

function isHeaderFunction(value: unknown): value is (call: CallOptions) => unknown {
  return typeof value === 'function';
}
