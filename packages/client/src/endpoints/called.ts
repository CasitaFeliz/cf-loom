import type { ContractPackage, Dependency, Endpoint, StandardRejections } from '@cf-loom/contract';
import {
  type AnswerableRejection,
  answerableByCodeOf,
  exportedEntryOf,
  type ObjectNode,
} from '@cf-loom/contract/internal';

/** Any Dependency, whatever it selects and whatever Standard codes its Provider resolved. */
export type AnyDependency = Dependency<ContractPackage, Readonly<Record<string, Endpoint>>>;

/** What an Endpoint is called through of its Provider's Contract Package: its name, Standard codes and nodes. */
export type Providing = Pick<ContractPackage, 'name' | 'standardRejections' | 'exportedSnapshot'>;

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
  const entry = exportedEntryOf(providing, endpoint);
  const standards = providing.standardRejections;
  return {
    provider: providing.name,
    name: endpoint.name,
    endpoint,
    inputHeaderNames: new Set(Object.keys(entry.input.headers?.fields ?? {})),
    successHeaders: entry.success.headers ?? undefined,
    rejectionsByCode: answerableByCodeOf(endpoint, standards),
    standards,
  };
}
