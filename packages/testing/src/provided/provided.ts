import type { AnyDependency } from '@cf-loom/client/internal';
import type { ContractPackage, Endpoint, ProvidedStandardRejections } from '@cf-loom/contract';
import {
  type AnswerableRejection,
  answerableByCodeOf,
  declaredByCodeOf,
  type EndpointSnapshot,
  exportedEntryOf,
  type Matchable,
  methodAndPathOf,
  pathSegmentsOf,
  providedSnapshotOf,
  type TextPartNodes,
  textPartNodesOf,
} from '@cf-loom/contract/internal';

/** An Endpoint a Dependency lists, prepared once for the requests that reach it. */
export type ListedEndpoint = {
  readonly provider: string;
  readonly name: string;
  readonly endpoint: Endpoint;
  readonly nodes: TextPartNodes;
  readonly deprecatedAt: string | undefined;
  readonly rejectionsByCode: ReadonlyMap<string, AnswerableRejection>;
  /** Every code the Provider's Contract Package declares, by its resolved code, the Endpoint's own among them. */
  readonly declaredByCode: ReadonlyMap<string, AnswerableRejection>;
  readonly standards: ProvidedStandardRejections;
};

/** An Endpoint the Provider exports, matched as `serve` would, and the listed one it is, if any. */
export type ExportedEndpoint = Matchable & {
  readonly identity: string;
  readonly listed: ListedEndpoint | undefined;
};

/** A Provider as its fake answers it: where it is reached, and every Endpoint it exports. */
export type FakedProvider = {
  readonly provider: string;
  readonly base: URL;
  readonly exported: readonly ExportedEndpoint[];
};

/**
 * A Dependency's Provider, prepared once: every Endpoint its Contract Package exports, so routing
 * precedence is the Provider's, and each listed one with what its requests are read by.
 */
export function fakedProviderOf(dependency: AnyDependency, base: URL): FakedProvider {
  const { provider } = dependency;
  const snapshot = providedSnapshotOf(provider);
  const endpoints = Object.values(provider.endpoints);
  const declaredByCode = declaredByCodeOf(endpoints, provider.standardRejections);
  const listedByEntry = new Map<EndpointSnapshot, ListedEndpoint>();
  for (const endpoint of dependency.endpoints ?? []) {
    const { name } = endpoint;
    const entry = exportedEntryOf(provider.name, snapshot, endpoint);
    const listing = { name, endpoint, entry };
    listedByEntry.set(entry, listedEndpointOf(provider, listing, declaredByCode));
  }
  const entries = Object.entries(snapshot.endpoints);
  const exported = entries.map(([identity, entry]) => {
    const { method, path } = methodAndPathOf(identity, entry.params);
    const segments = pathSegmentsOf(path);
    return { identity, method, segments, listed: listedByEntry.get(entry) };
  });
  return { provider: provider.name, base, exported };
}

/** A listed Endpoint by its name in code, its packaged declaration and its exported entry. */
type Listing = {
  readonly name: string;
  readonly endpoint: Endpoint;
  readonly entry: EndpointSnapshot;
};

function listedEndpointOf(
  provider: ContractPackage,
  { name, endpoint, entry }: Listing,
  declaredByCode: ReadonlyMap<string, AnswerableRejection>,
): ListedEndpoint {
  const standards = provider.standardRejections;
  return {
    provider: provider.name,
    name,
    endpoint,
    nodes: textPartNodesOf(entry),
    deprecatedAt: entry.deprecatedAt,
    rejectionsByCode: answerableByCodeOf(endpoint, standards),
    declaredByCode,
    standards,
  };
}

/** Who made a mistake with a listed Endpoint: its Provider and its name in code. */
export function whoOf(listed: ListedEndpoint): Who {
  return { provider: listed.provider, endpoint: listed.name };
}

/** A Provider and one of its listed Endpoints, as a mistake names them. */
export type Who = { readonly provider: string; readonly endpoint: string };
