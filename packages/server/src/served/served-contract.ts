import type { Endpoint, Guard, StandardRejections } from '@casitafeliz/loom-contract';
import {
  attachmentsOf,
  endpointsOf,
  isLive,
  type PathSegment,
  pathSegmentsOf,
  schemaOf,
  standardRejectionsOf,
} from '@casitafeliz/loom-contract/internal';
import type { TextNodes } from '../request/index.ts';
import {
  contractOf,
  deprecatedAtOf,
  endpointHandlerOf,
  guardHandlerOf,
  type ServedHandlers,
  textNodesFor,
} from './checks.ts';

/** A Guard as a live Endpoint attaches it: its Qualifier, its Handler and the text it demands. */
export type ServedAttachment = {
  readonly guard: Guard;
  readonly qualifier: unknown;
  readonly handler: { readonly element: Guard };
  readonly nodes: TextNodes;
};

/** What every declared Endpoint is matched by: its method and its path's segments. */
type Routed = {
  readonly endpoint: Endpoint;
  readonly method: string;
  readonly segments: readonly PathSegment[];
};

/** A live Endpoint, ready to answer: its Handler, Attachments, text nodes, body and stamp. */
export type LiveEndpoint = Routed & {
  readonly kind: 'live';
  readonly handler: { readonly element: Endpoint };
  readonly attachments: readonly ServedAttachment[];
  readonly nodes: TextNodes;
  readonly readsBody: boolean;
  readonly deprecatedAt: string | undefined;
};

/** A declared Endpoint as `serve` answers it: live, or Retired and still matched. */
export type ServedEndpoint = LiveEndpoint | (Routed & { readonly kind: 'retired' });

/** What `serve()` prepares once: every declared Endpoint and the resolved Standard Rejections. */
export type ServedContract = {
  readonly endpoints: readonly ServedEndpoint[];
  readonly standards: StandardRejections;
};

/** Prepares a Contract and its Handler map for serving, throwing on a Service assembled otherwise. */
export function servedContractOf(root: unknown, handlers: ServedHandlers): ServedContract {
  const contract = contractOf(root);
  return {
    endpoints: endpointsOf(contract).map((endpoint) => servedEndpointOf(endpoint, handlers)),
    standards: standardRejectionsOf(contract),
  };
}

function servedEndpointOf(endpoint: Endpoint, handlers: ServedHandlers): ServedEndpoint {
  const routed = { endpoint, method: endpoint.method, segments: pathSegmentsOf(endpoint.path) };
  if (!isLive(endpoint)) {
    return { ...routed, kind: 'retired' };
  }
  const walked = textNodesFor(endpoint);
  return {
    ...routed,
    kind: 'live',
    handler: endpointHandlerOf(handlers, endpoint),
    attachments: attachmentsOf(endpoint).map((attached) => ({
      ...attached,
      handler: guardHandlerOf(handlers, attached.guard),
      nodes: demandNodesOf(attached.guard),
    })),
    nodes: {
      params: walked.nodeOf('input.params'),
      query: walked.nodeOf('input.query'),
      headers: walked.nodeOf('input.headers'),
    },
    readsBody: schemaOf(endpoint, 'input.body') !== undefined,
    deprecatedAt: deprecatedAtOf(handlers, endpoint),
  };
}

function demandNodesOf(guard: Guard): TextNodes {
  const walked = textNodesFor(guard);
  return { query: walked.nodeOf('demands.query'), headers: walked.nodeOf('demands.headers') };
}
