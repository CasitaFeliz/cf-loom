import type { Endpoint } from '../declarations/index.ts';
import type { TextPartNodes } from '../validation/index.ts';
import { identityOf } from '../written/index.ts';
import type { EndpointSnapshot, ExportedSnapshot } from './types.ts';

/**
 * An exported Endpoint's entry in its Provider's decoded exported Snapshot, found by identity;
 * every Endpoint a Contract Package exports has one, so a missing entry is a bug.
 */
export function exportedEntryOf(
  provider: string,
  exported: ExportedSnapshot,
  endpoint: Endpoint,
): EndpointSnapshot {
  const identity = identityOf(endpoint.method, endpoint.path);
  const entry = exported.endpoints[identity];
  if (entry === undefined) {
    throw new Error(`The exported Snapshot of ${provider} has no ${identity}`);
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
    'input.query': query,
    'input.headers': headers,
  };
}
