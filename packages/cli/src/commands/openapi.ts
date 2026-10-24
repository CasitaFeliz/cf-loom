import { openApiDocumentOf } from '../openapi/index.ts';
import type { Run } from '../project/index.ts';
import { committedServiceOf, writtenDocumentExitOf } from './document.ts';
import type { Exit } from './exit.ts';
import { localVersion } from './package.ts';

/**
 * Prints the OpenAPI document of a Service's Endpoints from the committed Snapshot, which must be
 * what `generate` would write, so the document describes the reviewed file; an Application or a
 * Definitions Package offers no Endpoint.
 */
export async function openApiCommand(run: Run): Promise<Exit> {
  const committed = await committedServiceOf(run, noDocumentLine);
  if (committed.kind === 'stopped') {
    return committed.exit;
  }
  return writtenDocumentExitOf(openApiDocumentOf(committed.snapshot, localVersion));
}

function noDocumentLine(root: string): string {
  return `${root} has no OpenAPI document: only a Service offers Endpoints`;
}
