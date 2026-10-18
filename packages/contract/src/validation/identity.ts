import { textOf } from './written.ts';

/** The segments between the slashes of a path, a leading or trailing slash dropped. */
export function segmentsOf(path: string): readonly string[] {
  const inner = path.replace(/^\//, '').replace(/\/$/, '');
  return inner === '' ? [] : inner.split('/');
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
 * The path an Endpoint declares, from the path of its identity and its param names in order: the
 * reverse of `identityOf`, since the Snapshot stores the names apart from the identity.
 */
export function pathOf(identityPath: string, params: readonly string[]): string {
  const unused = [...params].reverse();
  const segments = segmentsOf(identityPath).map((segment) =>
    segment === '{}' ? `:${unused.pop() ?? ''}` : segment,
  );
  return `/${segments.join('/')}`;
}
