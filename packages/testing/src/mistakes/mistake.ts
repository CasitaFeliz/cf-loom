import type { Issue } from '@cf-loom/contract';
import { issueLineOf, linesTextOf } from '@cf-loom/contract/internal';

/**
 * A mistake in a test, never an Outcome: thrown out of a fake's `fetch` under its own name, which
 * the client passes through unchanged. The fake records it too, since the code under test may catch
 * it; `verify()` throws it again.
 */
export class FakeProviderError extends Error {
  override readonly name = 'FakeProviderError';
}

/** What a fake says went wrong with one Provider, or one of its Endpoints. */
export type Mistake = {
  readonly provider: string;
  readonly endpoint?: string;
  readonly what: string;
  readonly issues?: readonly Issue[];
  readonly cause?: unknown;
};

/** A mistake as thrown: who, what, then each Issue on its own line after who, never the value. */
export function mistakeOf({
  provider,
  endpoint,
  what,
  issues = [],
  cause,
}: Mistake): FakeProviderError {
  const who = endpoint === undefined ? provider : `${provider}: ${endpoint}`;
  const lines = [`${who}: ${what}`, ...issues.map((issue) => issueLineOf(who, issue))];
  const message = linesTextOf(lines);
  return cause === undefined
    ? new FakeProviderError(message)
    : new FakeProviderError(message, { cause });
}
