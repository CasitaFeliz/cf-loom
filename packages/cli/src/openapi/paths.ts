import {
  byCodePoint,
  type EndpointSnapshot,
  methodAndPathOf,
  type ServiceSnapshot,
} from '@cf-loom/contract/internal';

/** An Endpoint with its identity, its method and its path as an OpenAPI path template. */
export type ListedEndpoint = {
  readonly identity: string;
  readonly method: string;
  readonly path: string;
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
  return { identity, method, path: templateOf(path), endpoint };
}

/** A path that writes a param as `:name`, written as OpenAPI does: `{name}`. */
function templateOf(path: string): string {
  const segments = path.split('/').map((segment) => {
    return segment.startsWith(':') ? `{${segment.slice(1)}}` : segment;
  });
  return segments.join('/');
}

/**
 * The line saying which two Endpoints name one position of one path differently, which OpenAPI
 * cannot say: it allows one template for the path, whatever the method; none when none do.
 */
export function pathConflictLineOf(listed: readonly ListedEndpoint[]): string | undefined {
  const firstByShape = new Map<string, ListedEndpoint>();
  for (const next of listed) {
    const shape = next.identity.slice(next.identity.indexOf(' ') + 1);
    const first = firstByShape.get(shape);
    if (first === undefined) {
      firstByShape.set(shape, next);
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
