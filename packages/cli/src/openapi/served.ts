import {
  type CodeSnapshot,
  type EndpointSnapshot,
  isLive,
  type ObjectNode,
  type SchemaNode,
  type ServiceSnapshot,
} from '@cf-loom/contract/internal';
import { type Authorization, separatedAuthorizationOf } from './authorization.ts';

/** A Rejection an Endpoint answers: its code, with the status, message, headers and body that code has. */
export type ServedRejection = CodeSnapshot & { readonly code: string };

/** What `serve` reads of an Endpoint that is not Retired, and what it answers. */
export type LiveServed = {
  readonly kind: 'live';
  readonly input: EndpointSnapshot['input'];
  readonly success: EndpointSnapshot['success'];
  readonly rejections: readonly ServedRejection[];
  readonly deprecatedAt: string | undefined;
  readonly authorization: Authorization | undefined;
};

/** A Retired Endpoint reads its path alone and answers `RETIRED`, with no Success. */
export type RetiredServed = { readonly kind: 'retired'; readonly params: ObjectNode | null };

/** What `serve` reads of an Endpoint and what it answers, so what its OpenAPI operation writes. */
export type Served = LiveServed | RetiredServed;

/** What `serve` reads and answers for an Endpoint, each Rejection's code resolved. */
export function servedOf(
  endpoint: EndpointSnapshot,
  snapshot: Pick<ServiceSnapshot, 'codes' | 'guards'>,
): Served {
  if (!isLive(endpoint)) {
    return { kind: 'retired', params: endpoint.input.params };
  }
  const { headers, authorization } = separatedAuthorizationOf(endpoint, snapshot.guards);
  return {
    kind: 'live',
    input: { ...endpoint.input, headers },
    success: endpoint.success,
    rejections: endpoint.rejections.map((code) => servedRejectionOf(code, snapshot.codes)),
    deprecatedAt: endpoint.deprecatedAt,
    authorization,
  };
}

function servedRejectionOf(code: string, codes: ServiceSnapshot['codes']): ServedRejection {
  const codeSnapshot = codes[code];
  if (codeSnapshot === undefined) {
    throw new Error(`The Endpoint answers the code ${code}, which the codes given lack`);
  }
  return { code, ...codeSnapshot };
}

/** The Rejections an Endpoint answers, none for a Retired one. */
export function servedRejectionsOf(served: Served): readonly ServedRejection[] {
  return served.kind === 'live' ? served.rejections : [];
}

/** The security schemes an Endpoint's authorization header stands for, none for a Retired one. */
export function servedSchemesOf(served: Served): readonly string[] {
  return served.kind === 'live' ? (served.authorization?.schemes ?? []) : [];
}

/** The schemas an OpenAPI operation writes for what is served, so the defs they reach are written too. */
export function servedNodesOf(served: Served): readonly SchemaNode[] {
  switch (served.kind) {
    case 'retired':
      return [served.params].filter(isNode);
    case 'live': {
      const { input, success, rejections } = served;
      const parts = [
        input.params,
        input.query,
        input.headers,
        input.body,
        success.headers,
        success.body,
        ...rejections.flatMap(({ headers, body }) => [headers, body]),
      ];
      return parts.filter(isNode);
    }
  }
}

function isNode<Node extends SchemaNode>(node: Node | null): node is Node {
  return node !== null;
}
