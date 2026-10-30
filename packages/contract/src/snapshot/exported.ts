import type { Endpoint } from '../declarations/index.ts';
import { unbrokenLineOf } from '../lines/index.ts';
import { identityOf, type TextPartNodes } from '../written/index.ts';
import type { CodeSnapshot, EndpointSnapshot, ExportedCut } from './types.ts';

/**
 * An exported Endpoint's entry in the decoded exported Snapshot cut an Endpoint carries, found by
 * identity; every Endpoint a Contract Package exports has one, so a missing entry is a bug.
 */
export function exportedEntryOf(
  provider: string,
  cut: ExportedCut,
  endpoint: Endpoint,
): EndpointSnapshot {
  const identity = identityOf(endpoint.method, endpoint.path);
  const entry = cut.endpoints[identity];
  if (entry === undefined) {
    throw new Error(unbrokenLineOf(`The exported Snapshot of ${provider} has no ${identity}`));
  }
  return entry;
}

/**
 * A code's entry in the decoded exported Snapshot cut an Endpoint carries; every declared code an
 * exported Endpoint answers has one, so a missing entry is a bug.
 */
export function exportedCodeOf(provider: string, cut: ExportedCut, code: string): CodeSnapshot {
  const entry = Object.hasOwn(cut.codes, code) ? cut.codes[code] : undefined;
  if (entry === undefined) {
    throw new Error(unbrokenLineOf(`The exported Snapshot of ${provider} has no code ${code}`));
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
