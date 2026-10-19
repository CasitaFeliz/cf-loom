import type { Issue } from '@casitafeliz/loom-contract/internal';

/**
 * A mistake in a test, never an Outcome: thrown out of a fake's `fetch` under its own name, which
 * the client passes through unchanged, so the code under test cannot take it for a Fault.
 */
export class FakeProviderError extends Error {
  override readonly name = 'FakeProviderError';
}

/** What a fake of one Provider says went wrong with one of its Endpoints. */
export type Mistake = {
  readonly provider: string;
  readonly endpoint?: string;
  readonly what: string;
  readonly issues?: readonly Issue[];
  readonly cause?: unknown;
};

/** A mistake as thrown: who, what, then each Issue on its own line, never the value. */
export function mistakeOf({
  provider,
  endpoint,
  what,
  issues = [],
  cause,
}: Mistake): FakeProviderError {
  const who = endpoint === undefined ? provider : `${provider}: ${endpoint}`;
  const lines = [`${who}: ${what}`, ...issues.map(issueLineOf)];
  const message = lines.join('\n');
  return cause === undefined
    ? new FakeProviderError(message)
    : new FakeProviderError(message, { cause });
}

function issueLineOf({ part, path, code, message }: Issue): string {
  const at = path.length === 0 ? part : `${part} at ${path.join('.')}`;
  return `  ${at}: ${code}: ${message}`;
}
