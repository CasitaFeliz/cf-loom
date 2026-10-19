import type { Dependencies, Endpoint, StandardRejections } from '@casitafeliz/loom-contract';
import {
  type AnswerableRejection,
  answerableRejectionsOf,
  type EndpointSnapshot,
  identityOf,
  type ObjectNode,
  resolutionOf,
} from '@casitafeliz/loom-contract/internal';

/** Any Dependency, whatever it selects and whatever Standard codes its Provider resolved. */
export type AnyDependencies = Dependencies<
  Readonly<Record<string, Endpoint>>,
  unknown,
  StandardRejections
>;

/** What an Endpoint is called through of its Dependency: its Provider, Standard codes and nodes. */
export type Providing = Pick<
  AnyDependencies,
  'provider' | 'standardRejections' | 'exportedSnapshot'
>;

/**
 * One listed Endpoint as the client calls it and reads its answers, prepared once: the header
 * names its Input declares, its Success headers' nodes, and its Rejections by their resolved code.
 */
export type CalledEndpoint = {
  readonly provider: string;
  readonly name: string;
  readonly endpoint: Endpoint;
  readonly inputHeaderNames: ReadonlySet<string>;
  readonly successHeaders: ObjectNode | undefined;
  readonly rejectionsByCode: ReadonlyMap<string, AnswerableRejection>;
  readonly standards: StandardRejections;
};

/** An Endpoint a Dependency lists, prepared for calling, its nodes read from its Snapshot entry. */
export function calledEndpointOf(endpoint: Endpoint, providing: Providing): CalledEndpoint {
  const entry = snapshotEntryOf(endpoint, providing);
  const standards = providing.standardRejections;
  const rejections = answerableRejectionsOf(endpoint).map(
    (rejection) => [resolutionOf(rejection, standards).code, rejection] as const,
  );
  return {
    provider: providing.provider,
    name: endpoint.name,
    endpoint,
    inputHeaderNames: new Set(Object.keys(entry.input.headers?.fields ?? {})),
    successHeaders: entry.success.headers ?? undefined,
    rejectionsByCode: new Map(rejections),
    standards,
  };
}

/** An Endpoint's entry in its Provider's exported Snapshot, which every exported Endpoint has. */
function snapshotEntryOf(endpoint: Endpoint, providing: Providing): EndpointSnapshot {
  const identity = identityOf(endpoint.method, endpoint.path);
  const entry = providing.exportedSnapshot.endpoints[identity];
  if (entry === undefined) {
    throw new Error(`The exported Snapshot of ${providing.provider} has no ${identity}`);
  }
  return entry;
}
