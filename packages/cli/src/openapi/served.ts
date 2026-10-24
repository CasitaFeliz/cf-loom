import {
  type CodeSnapshot,
  type EndpointSnapshot,
  isLive,
  type SchemaNode,
  type ServiceSnapshot,
} from '@cf-loom/contract/internal';
import { type Authorization, separatedAuthorizationOf } from './authorization.ts';

/** A Rejection an Endpoint answers: its code, with the status, message and body that code has. */
export type ServedRejection = CodeSnapshot & { readonly code: string };

/**
 * What `serve` reads of an Endpoint and what it answers, so what its OpenAPI operation writes: a
 * Retired Endpoint reads its path alone and answers `RETIRED`, with no Success.
 */
export type Served = {
  readonly input: EndpointSnapshot['input'];
  readonly success: EndpointSnapshot['success'] | undefined;
  readonly rejections: readonly ServedRejection[];
  readonly deprecatedAt: string | undefined;
  readonly authorization: Authorization | undefined;
};

/** What `serve` reads and answers for an Endpoint, each Rejection's code resolved. */
export function servedOf(
  endpoint: EndpointSnapshot,
  snapshot: Pick<ServiceSnapshot, 'codes' | 'guards'>,
): Served {
  if (!isLive(endpoint)) {
    const { params } = endpoint.input;
    const input = { params, query: null, headers: null, body: null };
    return {
      input,
      success: undefined,
      rejections: [],
      deprecatedAt: undefined,
      authorization: undefined,
    };
  }
  const { headers, authorization } = separatedAuthorizationOf(endpoint, snapshot.guards);
  return {
    input: { ...endpoint.input, headers },
    success: endpoint.success,
    rejections: endpoint.rejections.map((code) => servedRejectionOf(code, snapshot.codes)),
    deprecatedAt: endpoint.deprecatedAt,
    authorization,
  };
}

function servedRejectionOf(code: string, codes: ServiceSnapshot['codes']): ServedRejection {
  const resolved = codes[code];
  if (resolved === undefined) {
    throw new Error(`The Endpoint answers the code ${code}, which the codes given lack`);
  }
  return { code, ...resolved };
}

/** The schemas an OpenAPI operation writes for what is served, so the defs they reach are written too. */
export function servedNodesOf({ input, success, rejections }: Served): readonly SchemaNode[] {
  const parts = [
    input.params,
    input.query,
    input.headers,
    input.body,
    success?.headers,
    success?.body,
    ...rejections.map(({ body }) => body),
  ];
  return parts.filter(isNode);
}

function isNode(node: SchemaNode | null | undefined): node is SchemaNode {
  return node !== null && node !== undefined;
}
