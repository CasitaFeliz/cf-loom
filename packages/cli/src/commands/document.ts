import type { ServiceSnapshot } from '@cf-loom/contract/internal';
import { builtOf } from '../project/index.ts';
import {
  committedStopOf,
  done,
  type Exit,
  failureExitOf,
  type Stopped,
  toolingError,
} from './exit.ts';
import type { Run } from './run.ts';

/** The Snapshot of a Service whose committed file is what `generate` would write. */
export type CommittedService = {
  readonly kind: 'service';
  readonly snapshot: ServiceSnapshot;
};

/** What a document is written to: its value, or the line saying what of the Snapshot its format cannot name. */
type Written =
  | { readonly kind: 'written'; readonly document: object }
  | { readonly kind: 'unnamed'; readonly line: string };

/**
 * The Service a command that prints what the committed Snapshot gives works on, from that Snapshot,
 * which must be what `generate` would write, so the output describes the reviewed file; an
 * Application or a Definitions Package stops it with the line `noOutputLineOf` words for the Root.
 */
export async function committedServiceOf(
  run: Run,
  noOutputLineOf: (root: string) => string,
): Promise<CommittedService | Stopped> {
  const built = await builtOf(run.cwd);
  if (built.kind !== 'built') {
    return { kind: 'stopped', exit: failureExitOf(built) };
  }
  const { snapshot } = built;
  switch (snapshot.kind) {
    case 'application':
      return { kind: 'stopped', exit: toolingError(noOutputLineOf('An Application')) };
    case 'definitions':
      return { kind: 'stopped', exit: toolingError(noOutputLineOf('A Definitions Package')) };
    case 'service': {
      const stop = committedStopOf(built);
      return stop === undefined ? { kind: 'service', snapshot } : { kind: 'stopped', exit: stop };
    }
  }
}

/** The document as JSON indented by two spaces, one entry per line, or the line saying what it cannot name. */
export function writtenDocumentExitOf(written: Written): Exit {
  switch (written.kind) {
    case 'unnamed':
      return toolingError(written.line);
    case 'written':
      return done(JSON.stringify(written.document, null, 2).split('\n'), {
        document: written.document,
      });
  }
}
