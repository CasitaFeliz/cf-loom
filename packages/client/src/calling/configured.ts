import type { CalledEndpoint } from '../endpoints/index.ts';

/** The headers given to `client()`, each a value or a function called per request. */
export type ConfiguredHeaders = Readonly<Record<string, unknown>>;

/**
 * A call's headers with those given to `client()` that its Endpoint declares and the call did not
 * pass, a function among them called now, and what it throws left to reach the Caller.
 */
export async function withConfiguredHeaders(
  called: CalledEndpoint,
  configured: ConfiguredHeaders,
  passed: unknown,
): Promise<unknown> {
  const missing = Object.entries(configured).filter(
    ([name]) => called.inputHeaderNames.has(name) && fieldOf(passed, name) === undefined,
  );
  if (missing.length === 0) {
    return passed;
  }
  const headers: Record<string, unknown> = isFields(passed) ? { ...passed } : {};
  for (const [name, value] of missing) {
    headers[name] = typeof value === 'function' ? await value() : value;
  }
  return headers;
}

function isFields(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldOf(value: unknown, field: string): unknown {
  return isFields(value) ? value[field] : undefined;
}
