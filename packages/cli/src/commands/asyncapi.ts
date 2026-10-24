import type { ServiceSnapshot } from '@cf-loom/contract/internal';
import { asyncApiDocumentOf } from '../asyncapi/index.ts';
import { builtOf, type Run } from '../project/index.ts';
import { committedStopOf, done, type Exit, failureExitOf, toolingError } from './exit.ts';

/**
 * Prints the AsyncAPI document of the Events a Service publishes from the committed Snapshot, which
 * must be what `generate` would write, so the document describes the reviewed file; an Application
 * or a Definitions Package publishes none.
 */
export async function asyncApiCommand(run: Run, prefix: string | null): Promise<Exit> {
  const built = await builtOf(run, 'committed');
  if (built.kind !== 'built') {
    return failureExitOf(built);
  }
  const { snapshot } = built;
  switch (snapshot.kind) {
    case 'application':
      return toolingError(noDocumentLine('An Application'));
    case 'definitions':
      return toolingError(noDocumentLine('A Definitions Package'));
    case 'service':
      return committedStopOf(built) ?? printedDocumentOf(snapshot, prefix);
  }
}

function noDocumentLine(root: string): string {
  return `${root} has no AsyncAPI document: only a Service publishes Events`;
}

/** The document as JSON indented by two spaces, one entry per line, or the line saying what it cannot name. */
function printedDocumentOf(snapshot: ServiceSnapshot, prefix: string | null): Exit {
  const written = asyncApiDocumentOf(snapshot, prefix);
  switch (written.kind) {
    case 'unnamed':
      return toolingError(written.line);
    case 'written':
      return done(JSON.stringify(written.document, null, 2).split('\n'));
  }
}
