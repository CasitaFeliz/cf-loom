import { type OpenApiDocument, openApiDocumentOf } from '../openapi/index.ts';
import { builtOf, type Run } from '../project/index.ts';
import { committedStopOf, done, type Exit, failureExitOf, toolingError } from './exit.ts';

/**
 * Prints the OpenAPI document of a Service's Endpoints from the committed Snapshot, which must be
 * what `generate` would write, so the document describes the reviewed file; an Application or a
 * Definitions Package offers no Endpoint.
 */
export async function openApiCommand(run: Run): Promise<Exit> {
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
    case 'service': {
      const stop = committedStopOf(built);
      if (stop !== undefined) {
        return stop;
      }
      const written = openApiDocumentOf(snapshot);
      switch (written.kind) {
        case 'unnamed':
          return toolingError(written.line);
        case 'written':
          return done(linesOf(written.document));
      }
    }
  }
}

function noDocumentLine(root: string): string {
  return `${root} has no OpenAPI document: only a Service offers Endpoints`;
}

/** The document as JSON indented by two spaces, one entry per line. */
function linesOf(document: OpenApiDocument): readonly string[] {
  return JSON.stringify(document, null, 2).split('\n');
}
