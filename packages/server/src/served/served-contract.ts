import type { Endpoint, Guard, StandardRejections } from '@casitafeliz/loom-contract';
import {
  attachmentsOf,
  endpointsOf,
  isLive,
  type PathSegment,
  pathSegmentsOf,
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

/** A Guard as a live Endpoint attaches it: its Qualifier and its Handler. */
export type ServedAttachment = {
  readonly guard: Guard;
  readonly qualifier: unknown;
  readonly handler: { readonly element: Guard };
};

/** What every declared Endpoint is matched by: its method and its path's segments. */
type Declared = {
  readonly declared: Endpoint;
  readonly method: string;
  readonly segments: readonly PathSegment[];
};

/** A live Endpoint, ready to answer: its Handler, its Attachments and its stamp. */
export type LiveEndpoint = Declared & {
  readonly kind: 'live';
  readonly handler: { readonly element: Endpoint };
  readonly attachments: readonly ServedAttachment[];
  readonly deprecatedAt: string | undefined;
};

/** A declared Endpoint as `serve` answers it: live, or Retired and still matched. */
export type ServedEndpoint = LiveEndpoint | (Declared & { readonly kind: 'retired' });

/**
 * What `serve()` prepares once: every declared Endpoint, the walked text parts of each Endpoint and
 * Guard, the Standard Rejections and the body limit.
 */
export type ServedContract = {
  readonly endpoints: readonly ServedEndpoint[];
  readonly nodes: ReadonlyMap<Endpoint | Guard, TextPartNodes>;
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
  const nodes = checkedTextPartsOf(contract);
  return {
    endpoints: endpointsOf(contract).map((endpoint) => servedEndpointOf(endpoint, handlers)),
    nodes,
    standards: standardRejectionsOf(contract),
    maxBodyBytes,
  };
}

function servedEndpointOf(endpoint: Endpoint, handlers: ServedHandlers): ServedEndpoint {
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
    })),
    deprecatedAt: deprecatedAtOf(handlers, endpoint),
  };
}
