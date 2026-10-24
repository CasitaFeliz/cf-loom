import type { Endpoint } from '../declarations/index.ts';
import { problemLineOf, type TextPartNodes } from '../validation/index.ts';
import { identityOf } from '../written/index.ts';
import { snapshotFormatOf } from './format.ts';
import type { EndpointSnapshot, ExportedSnapshot } from './types.ts';

/** A Provider as a Dependency carries it: its name and the Snapshot its Contract Package exports. */
export type Providing = {
  readonly provider: string;
  readonly exportedSnapshot: ExportedSnapshot;
};

/**
 * Refuses a Provider's exported Snapshot in a format this cf-loom does not read, before any of its
 * nodes is read, rather than reading it as far as it goes.
 */
export function checkExportedFormat(providing: Providing): void {
  const named = snapshotFormatOf(providing.exportedSnapshot);
  const exported = `${providing.provider}'s exported Snapshot`;
  switch (named.kind) {
    case 'known':
      return;
    case 'newer-format':
      throw new Error(
        `${exported} is in format ${named.format}, newer than this cf-loom reads: upgrade the @cf-loom packages`,
      );
    case 'malformed':
      throw new Error(`${exported} is malformed: ${problemLineOf(named)}`);
  }
}

/**
 * An exported Endpoint's entry in its Provider's exported Snapshot, found by identity; every
 * Endpoint a Contract Package exports has one, so a missing entry is a bug.
 */
export function exportedEntryOf(providing: Providing, endpoint: Endpoint): EndpointSnapshot {
  const identity = identityOf(endpoint.method, endpoint.path);
  const entry = providing.exportedSnapshot.endpoints[identity];
  if (entry === undefined) {
    throw new Error(`The exported Snapshot of ${providing.provider} has no ${identity}`);
  }
  return entry;
}

/**
 * The nodes an exported Endpoint's text parts are read by: its Input's, whose headers and query
 * already hold its Guards' demands, as the Snapshot merges them.
 */
export function textPartNodesOf(entry: EndpointSnapshot): TextPartNodes {
  const { params, query, headers } = entry.input;
  return {
    ...(params !== null && { 'input.params': params }),
    ...(query !== null && { 'input.query': query }),
    ...(headers !== null && { 'input.headers': headers }),
  };
}
