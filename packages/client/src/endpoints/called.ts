import type {
  ContractPackage,
  Dependency,
  Endpoint,
  ProvidedStandardRejections,
} from '@cf-loom/contract';
import {
  type AnswerableRejection,
  answerableByCodeOf,
  exportedEntryOf,
  type ObjectNode,
} from '@cf-loom/contract/internal';

/** Any Dependency, whatever it selects and whatever Standard codes its Provider resolved. */
export type AnyDependency = Dependency<ContractPackage, readonly Endpoint[]>;

/** The Endpoints a Dependency lists: none when it was written without the list. */
export type ListedEndpoints<D extends AnyDependency> = D extends {
  readonly endpoints?: infer Listed;
}
  ? Extract<Listed, readonly Endpoint[]>
  : never;

/** The name of each Endpoint a Dependency lists: a method of its client and a script of its fake. */
export type ListedName<D extends AnyDependency> = ListedEndpoints<D>[number]['name'];

/** The Endpoint a Dependency lists under a name. */
export type ListedEndpoint<D extends AnyDependency, Name> = Extract<
  ListedEndpoints<D>[number],
  { readonly name: Name }
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
  readonly standards: ProvidedStandardRejections;
};

/** An Endpoint a Dependency lists, prepared for calling, its nodes read from its Snapshot entry. */
export function calledEndpointOf(endpoint: Endpoint, provider: ContractPackage): CalledEndpoint {
  const entry = exportedEntryOf(provider, endpoint);
  const standards = provider.standardRejections;
  return {
    provider: provider.name,
    name: endpoint.name,
    endpoint,
    inputHeaderNames: new Set(Object.keys(entry.input.headers?.fields ?? {})),
    successHeaders: entry.success.headers ?? undefined,
    rejectionsByCode: answerableByCodeOf(endpoint, standards),
    standards,
  };
}
