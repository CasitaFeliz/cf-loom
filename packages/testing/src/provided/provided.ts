import type { AnyDependency } from '@cf-loom/client/internal';
import type {
  Endpoint,
  Lifecycle,
  ProvidedEndpoint,
  ProvidedStandardRejections,
} from '@cf-loom/contract';
import {
  type AnswerableRejection,
  answerableByCodeOf,
  carriedStandardRejectionsOf,
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
  providerOf,
  type TextPartNodes,
  textPartNodesOf,
} from '@cf-loom/contract/internal';

/** An Endpoint a Dependency lists, where it is reached and what its requests are read by, prepared once. */
export type ListedEndpoint = EndpointPath & {
  readonly kind: 'listed';
  readonly provider: string;
  readonly name: string;
  readonly endpoint: Endpoint;
  readonly nodes: TextPartNodes;
  readonly deprecatedAt: string | undefined;
  readonly rejectionsByCode: ReadonlyMap<string, AnswerableRejection>;
  /** Every code the listed Endpoints declare, by its resolved code, this one's among them, and the Standard ones. */
  readonly declaredByCode: ReadonlyMap<string, AnswerableRejection>;
  readonly standards: ProvidedStandardRejections;
};

/** A declared Endpoint the Dependency does not list that wins a URL a listed one matches. */
export type ShadowingEndpoint = EndpointPath & {
  readonly kind: 'shadowing';
  readonly lifecycle: Lifecycle;
};

/**
 * A Provider as its fake answers it: where it is reached, what a Consumer may send (the Endpoints
 * the Dependency lists), and which declared Endpoint wins a request among those and the ones their
 * cuts list as `shadowing`.
 */
export type FakedProvider = {
  readonly provider: string;
  readonly base: URL;
  readonly listed: readonly ListedEndpoint[];
  readonly declared: readonly (ListedEndpoint | ShadowingEndpoint)[];
};

/**
 * A Dependency's Provider, prepared once from the Endpoints it lists: each read from the exported
 * Snapshot cut it carries, and with those every other one their cuts list as `shadowing`, so the
 * winner of a request is the Provider's.
 */
export function fakedProviderOf(dependency: AnyDependency, base: URL): FakedProvider {
  const { endpoints } = dependency;
  const { name, standardRejections } = listedProviderOf(dependency);
  const declaredByCode = declaredByCodeOf(endpoints, standardRejections);
  const cuts = endpoints.map(cutOf);
  const listed = cuts.map((cut) => listedEndpointOf(cut, declaredByCode));
  const declared = [...listed, ...shadowingEndpointsOf(cuts)];
  return { provider: name, base, listed, declared };
}

/** The Provider whose Endpoints a Dependency lists, as they carry it: its name, which names its fake, and its Standard Rejections. */
export function listedProviderOf(dependency: AnyDependency): {
  readonly name: string;
  readonly standardRejections: ProvidedStandardRejections;
} {
  const [first] = dependency.endpoints;
  if (first === undefined) {
    throw new Error('A Dependency lists at least one Endpoint, so its fake has a Provider');
  }
  return { name: providerOf(first), standardRejections: carriedStandardRejectionsOf(first) };
}

/** A listed Endpoint as its own cut holds it: its identity, its entry, and the Endpoints the cut lists as `shadowing`. */
type Cut = {
  readonly endpoint: ProvidedEndpoint;
  readonly identity: string;
  readonly entry: EndpointSnapshot;
  readonly shadowing: ExportedCut['shadowing'];
};

function cutOf(endpoint: ProvidedEndpoint): Cut {
  const snapshot = providedSnapshotOf(endpoint);
  const entry = exportedEntryOf(providerOf(endpoint), snapshot, endpoint);
  const identity = identityOf(endpoint.method, endpoint.path);
  return { endpoint, identity, entry, shadowing: snapshot.shadowing };
}

/** The Endpoints the cuts list as `shadowing` that the Dependency does not list, each once. */
function shadowingEndpointsOf(cuts: readonly Cut[]): readonly ShadowingEndpoint[] {
  const listed = new Set(cuts.map(({ identity }) => identity));
  const shadowing = new Map(cuts.flatMap((cut) => Object.entries(cut.shadowing)));
  return [...shadowing]
    .filter(([identity]) => !listed.has(identity))
    .map(([identity, { lifecycle }]) => {
      return { kind: 'shadowing', ...endpointPathOf(identity), lifecycle };
    });
}

function listedEndpointOf(
  { endpoint, identity, entry }: Cut,
  declaredByCode: ReadonlyMap<string, AnswerableRejection>,
): ListedEndpoint {
  const standards = carriedStandardRejectionsOf(endpoint);
  const { method, path } = methodAndPathOf(identity, entry.params);
  return {
    kind: 'listed',
    identity,
    method,
    segments: pathSegmentsOf(path),
    provider: providerOf(endpoint),
    name: endpoint.name,
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
