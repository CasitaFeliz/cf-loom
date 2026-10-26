import type { AnyDependency } from '@cf-loom/client/internal';
import type {
  ContractPackage,
  Endpoint,
  Lifecycle,
  ProvidedStandardRejections,
} from '@cf-loom/contract';
import {
  type AnswerableRejection,
  answerableByCodeOf,
  declaredByCodeOf,
  type EndpointPath,
  type EndpointSnapshot,
  type ExportedCut,
  endpointPathOf,
  exportedEntryOf,
  identityOf,
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

/** An Endpoint the Provider exports, and the listed Endpoint it is, if any. */
export type ExportedEndpoint = EndpointPath & {
  readonly kind: 'exported';
  readonly listed: ListedEndpoint | undefined;
};

/** A declared Endpoint the Provider does not export that wins a URL an exported one matches. */
export type ShadowingEndpoint = EndpointPath & {
  readonly kind: 'shadowing';
  readonly lifecycle: Lifecycle;
};

/**
 * A Provider as its fake answers it: where it is reached, what a Consumer may send (the Endpoints
 * it exports), and which declared Endpoint wins a request among those and its `shadowing` ones.
 */
export type FakedProvider = {
  readonly provider: string;
  readonly base: URL;
  readonly exported: readonly ExportedEndpoint[];
  readonly declared: readonly (ExportedEndpoint | ShadowingEndpoint)[];
};

/**
 * A Dependency's Provider, prepared once: every Endpoint its Contract Package exports, each read
 * from the exported Snapshot cut it carries, and with those every one the cuts list as `shadowing`,
 * so the winner of a request is the Provider's, and each listed one with what its requests are read by.
 */
export function fakedProviderOf(dependency: AnyDependency, base: URL): FakedProvider {
  const { provider } = dependency;
  const endpoints = Object.values(provider.endpoints);
  const declaredByCode = declaredByCodeOf(endpoints, provider.standardRejections);
  const listedByIdentity = new Map<string, ListedEndpoint>();
  for (const endpoint of dependency.endpoints ?? []) {
    const cut = cutOf(provider.name, endpoint);
    const listing = { name: endpoint.name, endpoint, entry: cut.entry };
    listedByIdentity.set(cut.identity, listedEndpointOf(provider, listing, declaredByCode));
  }
  const cuts = endpoints.map((endpoint) => cutOf(provider.name, endpoint));
  const exported = cuts.map((cut) => exportedEndpointOf(cut, listedByIdentity.get(cut.identity)));
  const declared = [...exported, ...shadowingEndpointsOf(cuts)];
  return { provider: provider.name, base, exported, declared };
}

/** An exported Endpoint as its own cut holds it: its identity, its entry, and the Endpoints the cut lists as `shadowing`. */
type Cut = {
  readonly identity: string;
  readonly entry: EndpointSnapshot;
  readonly shadowing: ExportedCut['shadowing'];
};

function cutOf(provider: string, endpoint: Endpoint): Cut {
  const snapshot = providedSnapshotOf(endpoint);
  const entry = exportedEntryOf(provider, snapshot, endpoint);
  const identity = identityOf(endpoint.method, endpoint.path);
  return { identity, entry, shadowing: snapshot.shadowing };
}

function exportedEndpointOf(
  { identity, entry }: Cut,
  listed: ListedEndpoint | undefined,
): ExportedEndpoint {
  const { method, path } = methodAndPathOf(identity, entry.params);
  return { kind: 'exported', identity, method, segments: pathSegmentsOf(path), listed };
}

/** The declared Endpoints the cuts list as `shadowing` that the Provider does not export, each once. */
function shadowingEndpointsOf(cuts: readonly Cut[]): readonly ShadowingEndpoint[] {
  const exported = new Set(cuts.map(({ identity }) => identity));
  const listed = new Map(cuts.flatMap(({ shadowing }) => Object.entries(shadowing)));
  return [...listed]
    .filter(([identity]) => !exported.has(identity))
    .map(([identity, { lifecycle }]) => {
      return { kind: 'shadowing', ...endpointPathOf(identity), lifecycle };
    });
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
