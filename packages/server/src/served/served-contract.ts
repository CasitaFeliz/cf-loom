import type { Endpoint, Guard, StandardRejections } from '@casitafeliz/loom-contract';
import {
  attachmentsOf,
  endpointsOf,
  isLive,
  type PathSegment,
  pathSegmentsOf,
  schemaOf,
  standardRejectionsOf,
  type TextPartNodes,
} from '@casitafeliz/loom-contract/internal';
import {
  checkedTextPartsOf,
  contractOf,
  deprecatedAtOf,
  endpointHandlerOf,
  guardHandlerOf,
  type ServedHandlers,
} from './checks.ts';

/** A Guard as a live Endpoint attaches it: its Qualifier, its Handler and the text it demands. */
export type ServedAttachment = {
  readonly guard: Guard;
  readonly qualifier: unknown;
  readonly handler: { readonly element: Guard };
  readonly nodes: TextPartNodes;
};

/** What every declared Endpoint is matched by: its method and its path's segments. */
type Declared = {
  readonly declared: Endpoint;
  readonly method: string;
  readonly segments: readonly PathSegment[];
};

/** A live Endpoint, ready to answer: its Handler, Attachments, text nodes, body and stamp. */
export type LiveEndpoint = Declared & {
  readonly kind: 'live';
  readonly handler: { readonly element: Endpoint };
  readonly attachments: readonly ServedAttachment[];
  readonly nodes: TextPartNodes;
  readonly readsBody: boolean;
  readonly deprecatedAt: string | undefined;
};

/** A declared Endpoint as `serve` answers it: live, or Retired and still matched. */
export type ServedEndpoint = LiveEndpoint | (Declared & { readonly kind: 'retired' });

/** What `serve()` prepares once: every declared Endpoint, the Standard Rejections and the body limit. */
export type ServedContract = {
  readonly endpoints: readonly ServedEndpoint[];
  readonly standards: StandardRejections;
  readonly maxBodyBytes: number | undefined;
};

/** Prepares a Contract and its Handler map for serving, throwing on a Service assembled otherwise. */
export function servedContractOf(
  root: unknown,
  handlers: ServedHandlers,
  maxBodyBytes: number | undefined,
): ServedContract {
  const contract = contractOf(root);
  const preparing = { handlers, nodes: checkedTextPartsOf(contract) };
  return {
    endpoints: endpointsOf(contract).map((endpoint) => servedEndpointOf(endpoint, preparing)),
    standards: standardRejectionsOf(contract),
    maxBodyBytes,
  };
}

/** What each Endpoint is prepared from: the Handler map and the walked text parts by declaration. */
type Preparing = {
  readonly handlers: ServedHandlers;
  readonly nodes: ReadonlyMap<Endpoint | Guard, TextPartNodes>;
};

function servedEndpointOf(endpoint: Endpoint, { handlers, nodes }: Preparing): ServedEndpoint {
  const declared = {
    declared: endpoint,
    method: endpoint.method,
    segments: pathSegmentsOf(endpoint.path),
  };
  if (!isLive(endpoint)) {
    return { ...declared, kind: 'retired' };
  }
  return {
    ...declared,
    kind: 'live',
    handler: endpointHandlerOf(handlers, endpoint),
    attachments: attachmentsOf(endpoint).map((attached) => ({
      ...attached,
      handler: guardHandlerOf(handlers, attached.guard),
      nodes: nodes.get(attached.guard) ?? {},
    })),
    nodes: nodes.get(endpoint) ?? {},
    readsBody: schemaOf(endpoint, 'input.body') !== undefined,
    deprecatedAt: deprecatedAtOf(handlers, endpoint),
  };
}
