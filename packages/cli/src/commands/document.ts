import type { ServiceSnapshot } from '@cf-loom/contract/internal';
import { builtOf, type Run } from '../project/index.ts';
import {
  committedStopOf,
  done,
  type Exit,
  failureExitOf,
  type Stopped,
  toolingError,
} from './exit.ts';

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
 * The Service a command that prints a document works on, from the committed Snapshot, which must be
 * what `generate` would write, so the document describes the reviewed file; an Application or a
 * Definitions Package stops it with the line `noDocumentLineOf` words for the root.
 */
export async function committedServiceOf(
  run: Run,
  noDocumentLineOf: (root: string) => string,
): Promise<CommittedService | Stopped> {
  const built = await builtOf(run, 'committed');
  if (built.kind !== 'built') {
    return { kind: 'stopped', exit: failureExitOf(built) };
  }
  const { snapshot } = built;
  switch (snapshot.kind) {
    case 'application':
      return { kind: 'stopped', exit: toolingError(noDocumentLineOf('An Application')) };
    case 'definitions':
      return { kind: 'stopped', exit: toolingError(noDocumentLineOf('A Definitions Package')) };
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
