import {
  byCodePoint,
  type EndpointSnapshot,
  methodAndPathOf,
  type PathSegment,
  pathSegmentsOf,
  type ServiceSnapshot,
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
  const segments = pathSegmentsOf(path);
  return {
    identity,
    method,
    path: pathTextOf(segments, (name) => `{${name}}`),
    shape: pathTextOf(segments, () => '{}'),
    endpoint,
  };
}

/** A path's text with each param written as the function says. */
function pathTextOf(segments: readonly PathSegment[], param: (name: string) => string): string {
  const texts = segments.map((segment) =>
    segment.kind === 'param' ? param(segment.name) : segment.text,
  );
  return `/${texts.join('/')}`;
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
  const names = `${first.endpoint.params[position]} and ${next.endpoint.params[position]}`;
  return `${first.identity} and ${next.identity} name path param ${position + 1} ${names}: an OpenAPI path names it once, so rename one`;
}
