import type { AnyDependencies } from '@casitafeliz/loom-client/internal';
import type { Endpoint, StandardRejections } from '@casitafeliz/loom-contract';
import {
  type AnswerableRejection,
  answerableByCodeOf,
  type EndpointSnapshot,
  exportedEntryOf,
  type Matchable,
  methodAndPathOf,
  pathSegmentsOf,
  schemaOf,
  type TextPartNodes,
  textPartNodesOf,
} from '@casitafeliz/loom-contract/internal';

/** An Endpoint a Dependency lists, prepared once for the requests that reach it. */
export type ListedEndpoint = {
  readonly provider: string;
  readonly name: string;
  readonly endpoint: Endpoint;
  readonly nodes: TextPartNodes;
  readonly readsBody: boolean;
  readonly deprecatedAt: string | undefined;
  readonly rejectionsByCode: ReadonlyMap<string, AnswerableRejection>;
  readonly standards: StandardRejections;
};

/** An Endpoint the Provider exports, matched as `serve` would, and the listed one it is, if any. */
export type ExportedEndpoint = Matchable & {
  readonly identity: string;
  readonly listed: ListedEndpoint | undefined;
};

/** A Provider as its fake answers it: where it is reached, and every Endpoint it exports. */
export type Provided = {
  readonly provider: string;
  readonly base: URL;
  readonly exported: readonly ExportedEndpoint[];
};

/**
 * A Dependency's Provider, prepared once: every Endpoint its Contract Package exports, so routing
 * precedence is the Provider's, and each listed one with what its requests are read by.
 */
export function providedOf(deps: AnyDependencies, base: URL): Provided {
  const listedByEntry = new Map<EndpointSnapshot, ListedEndpoint>();
  for (const [name, endpoint] of Object.entries(deps.endpoints)) {
    const entry = exportedEntryOf(deps, endpoint);
    listedByEntry.set(entry, listedEndpointOf(deps, { name, endpoint, entry }));
  }
  const entries = Object.entries(deps.exportedSnapshot.endpoints);
  const exported = entries.map(([identity, entry]) => {
    const { method, path } = methodAndPathOf(identity, entry.params);
    const segments = pathSegmentsOf(path);
    return { identity, method, segments, listed: listedByEntry.get(entry) };
  });
  return { provider: deps.provider, base, exported };
}

/** A listed Endpoint by its name in code, its packaged declaration and its exported entry. */
type Listing = {
  readonly name: string;
  readonly endpoint: Endpoint;
  readonly entry: EndpointSnapshot;
};

function listedEndpointOf(
  deps: AnyDependencies,
  { name, endpoint, entry }: Listing,
): ListedEndpoint {
  const standards = deps.standardRejections;
  return {
    provider: deps.provider,
    name,
    endpoint,
    nodes: textPartNodesOf(entry),
    readsBody: schemaOf(endpoint, 'input.body') !== undefined,
    deprecatedAt: entry.deprecatedAt,
    rejectionsByCode: answerableByCodeOf(endpoint, standards),
    standards,
  };
}
