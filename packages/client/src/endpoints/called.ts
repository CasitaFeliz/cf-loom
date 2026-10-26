import type {
  ContractPackage,
  Dependency,
  Endpoint,
  ProvidedStandardRejections,
} from '@cf-loom/contract';
import {
  answerableByCodeOf,
  exportedCodeOf,
  exportedEntryOf,
  isRejection,
  type ObjectNode,
  providedSnapshotOf,
  type ReadShape,
  rejectionShapeOf,
  successShapeOf,
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
 * A Success or a Rejection an Endpoint answers, prepared once: its shape, and the node its headers
 * are read by, none for a Standard Rejection, which declares no headers.
 */
export type CalledShape = {
  readonly shape: ReadShape;
  readonly headers: ObjectNode | undefined;
};

/**
 * One listed Endpoint as the client calls it and reads its answers, prepared once: the header
 * names its Input declares, its Success, and its Rejections by their resolved code.
 */
export type CalledEndpoint = {
  readonly provider: string;
  readonly name: string;
  readonly endpoint: Endpoint;
  readonly inputHeaderNames: ReadonlySet<string>;
  readonly success: CalledShape;
  readonly rejections: ReadonlyMap<string, CalledShape>;
  readonly standards: ProvidedStandardRejections;
};

/** An Endpoint a Dependency lists, prepared for calling, its nodes read from its entry and its codes' in the exported Snapshot cut it carries. */
export function calledEndpointOf(endpoint: Endpoint, provider: ContractPackage): CalledEndpoint {
  const exported = providedSnapshotOf(endpoint);
  const entry = exportedEntryOf(provider.name, exported, endpoint);
  const standards = provider.standardRejections;
  const answered = answerableByCodeOf(endpoint, standards);
  const rejections = [...answered].map(([code, rejection]): readonly [string, CalledShape] => {
    const headers = isRejection(rejection)
      ? exportedCodeOf(provider.name, exported, code).headers
      : undefined;
    return [code, { shape: rejectionShapeOf(rejection, standards), headers }];
  });
  return {
    provider: provider.name,
    name: endpoint.name,
    endpoint,
    inputHeaderNames: new Set(Object.keys(entry.input.headers.fields)),
    success: { shape: successShapeOf(endpoint), headers: entry.success.headers },
    rejections: new Map(rejections),
    standards,
  };
}
