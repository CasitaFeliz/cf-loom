import type { Endpoint, ExportedSnapshot, StandardRejections } from '@casitafeliz/loom-contract';
import {
  type AnswerableRejection,
  answerableRejectionsOf,
  type EndpointSnapshot,
  identityOf,
  type ObjectNode,
  resolutionOf,
} from '@casitafeliz/loom-contract/internal';

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

/** The Dependency an Endpoint is called through: its Provider, its resolved Standard codes and nodes. */
export type Providing = {
  readonly provider: string;
  readonly standards: StandardRejections;
  readonly exportedSnapshot: ExportedSnapshot;
};

/** An Endpoint a Dependency lists, prepared for calling, its nodes read from its Snapshot entry. */
export function calledEndpointOf(endpoint: Endpoint, providing: Providing): CalledEndpoint {
  const entry = snapshotEntryOf(endpoint, providing);
  const rejections = answerableRejectionsOf(endpoint).map(
    (rejection) => [resolutionOf(rejection, providing.standards).code, rejection] as const,
  );
  return {
    provider: providing.provider,
    name: endpoint.name,
    endpoint,
    inputHeaderNames: new Set(Object.keys(entry.input.headers?.fields ?? {})),
    successHeaders: entry.success.headers ?? undefined,
    rejectionsByCode: new Map(rejections),
    standards: providing.standards,
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
