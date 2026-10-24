import { asyncApiDocumentOf } from '../asyncapi/index.ts';
import type { Run } from '../project/index.ts';
import { committedServiceOf, writtenDocumentExitOf } from './document.ts';
import type { Exit } from './exit.ts';
import { localVersion } from './package.ts';

/**
 * Prints the AsyncAPI document of the Events a Service publishes from the committed Snapshot, which
 * must be what `generate` would write, so the document describes the reviewed file; an Application
 * or a Definitions Package publishes none.
 */
export async function asyncApiCommand(run: Run, prefix: string | null): Promise<Exit> {
  const committed = await committedServiceOf(run, noDocumentLine);
  if (committed.kind === 'stopped') {
    return committed.exit;
  }
  return writtenDocumentExitOf(asyncApiDocumentOf(committed.snapshot, prefix, localVersion));
}

function noDocumentLine(root: string): string {
  return `${root} has no AsyncAPI document: only a Service publishes Events`;
}
