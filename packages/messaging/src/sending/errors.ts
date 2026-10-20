import type { Issue } from '@cf-loom/handlers';
import { issueLineOf } from '@cf-loom/handlers/internal';

/** A Message Version whose body broke its schema, by its identity, with the Issues it broke at `body`. */
export type InvalidBody = { readonly identity: string; readonly issues: readonly Issue[] };

/** Thrown by `publish` or `send` given a body that breaks its version's schema; nothing was sent. */
export class InvalidMessageError extends Error {
  override readonly name = 'InvalidMessageError';
  readonly invalid: readonly InvalidBody[];

  constructor(invalid: readonly InvalidBody[]) {
    super(invalid.flatMap(linesOf).join('\n'));
    this.invalid = invalid;
  }
}

/** Thrown by `publish` when a version could not be sent: the Fact id to retry with and the versions already sent. */
export class PublishError extends Error {
  override readonly name = 'PublishError';
  readonly factId: string;
  readonly sent: readonly string[];

  constructor(
    event: string,
    published: { readonly factId: string; readonly sent: readonly string[] },
    cause: unknown,
  ) {
    const sent = published.sent.length === 0 ? 'none' : published.sent.join(', ');
    super(`${event} was not published whole with Fact id ${published.factId}; sent: ${sent}`, {
      cause,
    });
    this.factId = published.factId;
    this.sent = published.sent;
  }
}

function linesOf({ identity, issues }: InvalidBody): readonly string[] {
  return issues.map((issue) => issueLineOf(identity, issue));
}
