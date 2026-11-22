import {
  byCodePoint,
  type EndpointSnapshot,
  joinedOf,
  methodAndPathOf,
  type PathSegment,
  pathSegmentsOf,
  readEndpointIdentity,
  type ServiceSnapshot,
  wordOf,
} from '@cf-loom/contract/internal';

/** An Endpoint with its identity, its method, its OpenAPI path template and the shape of that path. */
export type ListedEndpoint = {
  readonly identity: string;
  readonly method: string;
  readonly path: string;
  readonly shape: string;
  readonly endpoint: EndpointSnapshot;
};

/** Every Endpoint in code point order of its identity, each with its OpenAPI path: `/orders/{orderId}`. */
export function listedEndpointsOf(
  endpoints: ServiceSnapshot['endpoints'],
): readonly ListedEndpoint[] {
  return Object.entries(endpoints)
    .sort(([left], [right]) => byCodePoint(left, right))
    .map(([identity, endpoint]) => listedOf(identity, endpoint));
}

function listedOf(identity: string, endpoint: EndpointSnapshot): ListedEndpoint {
  const { method, path } = methodAndPathOf(identity, endpoint.params);
  const template = templateOf(pathSegmentsOf(path));
  return { identity, method, path: template, shape: shapeOf(identity), endpoint };
}

/** A path's text with each param written in braces, as OpenAPI does. */
function templateOf(segments: readonly PathSegment[]): string {
  const texts = segments.map((segment) =>
    segment.kind === 'param' ? `{${segment.name}}` : segment.text,
  );
  return `/${texts.join('/')}`;
}

/** The path of an identity, which two Endpoints on one path share whatever they name its params. */
function shapeOf(identity: string): string {
  const read = readEndpointIdentity(identity);
  if (read === undefined) {
    throw new Error(`${identity} is no Endpoint’s identity: a bug.`);
  }
  return read.identityPath;
}

/** The line naming two Endpoints on one path that name a param differently, which OpenAPI cannot say. */
export function pathConflictLineOf(listed: readonly ListedEndpoint[]): string | undefined {
  const firstByShape = new Map<string, ListedEndpoint>();
  for (const next of listed) {
    const first = firstByShape.get(next.shape);
    if (first === undefined) {
      firstByShape.set(next.shape, next);
      continue;
    }
    const position = first.endpoint.params.findIndex(
      (name, at) => name !== next.endpoint.params[at],
    );
    if (position >= 0) {
      return conflictLineOf(first, next, position);
    }
  }
  return undefined;
}

function conflictLineOf(first: ListedEndpoint, next: ListedEndpoint, position: number): string {
  const identities = joinedOf([wordOf(first.identity), wordOf(next.identity)], 'and');
  const names = joinedOf(
    [wordOf(first.endpoint.params[position] ?? ''), wordOf(next.endpoint.params[position] ?? '')],
    'and',
  );
  return `${identities} name path param ${position + 1} ${names}: an OpenAPI path names it once, so rename one`;
}
