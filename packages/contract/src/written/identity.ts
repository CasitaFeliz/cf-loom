import { textOf } from './written.ts';

/** The segments between the slashes of a path, a leading or trailing slash dropped. */
export function segmentsOf(path: string): readonly string[] {
  const inner = path.replace(/^\//, '').replace(/\/$/, '');
  return inner === '' ? [] : inner.split('/');
}

/** A segment of a canonical path: a literal, or a `:name` param. */
export type PathSegment =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'param'; readonly name: string };

/** The segments of a canonical path, a literal or a param, so a request is matched by them alone. */
export function pathSegmentsOf(path: string): readonly PathSegment[] {
  return segmentsOf(path).map((segment) =>
    segment.startsWith(':')
      ? { kind: 'param', name: segment.slice(1) }
      : { kind: 'literal', text: segment },
  );
}

/** The `:names` of a path, in order, as its params must declare them. */
export function paramNamesOf(path: string): readonly string[] {
  return segmentsOf(path)
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

/**
 * An Endpoint's identity: its method and its path with every param replaced by `{}`. A path that
 * is not canonical still gets one, so every failure of the Endpoint has a location.
 */
export function identityOf(method: unknown, path: unknown): string {
  const segments = segmentsOf(textOf(path)).map((segment) =>
    segment.startsWith(':') ? '{}' : segment,
  );
  return `${textOf(method)} /${segments.join('/')}`;
}

/**
 * A Message Version's identity, `OrderCreated@2`; one that breaks its rules still gets one, so every
 * failure of it has a location.
 */
export function messageIdentityOf(name: unknown, version: unknown): string {
  return `${textOf(name)}@${textOf(version)}`;
}

/**
 * A Message Version's name and version from its identity, `OrderCreated@2`: the reverse of
 * `messageIdentityOf`, since the Snapshot keys a Message Version by its identity alone.
 */
export function messageVersionOf(identity: string): {
  readonly name: string;
  readonly version: number;
} {
  const separator = identity.lastIndexOf('@');
  return { name: identity.slice(0, separator), version: Number(identity.slice(separator + 1)) };
}

/**
 * The method and the path an Endpoint declares, from its identity and its param names in order:
 * the reverse of `identityOf`, since the Snapshot stores the names apart from the identity.
 */
export function methodAndPathOf(
  identity: string,
  params: readonly string[],
): { readonly method: string; readonly path: string } {
  const separator = identity.indexOf(' ');
  const unused = [...params].reverse();
  const segments = segmentsOf(identity.slice(separator + 1)).map((segment) =>
    segment === '{}' ? `:${unused.pop() ?? ''}` : segment,
  );
  return { method: identity.slice(0, separator), path: `/${segments.join('/')}` };
}
