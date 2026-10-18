import type { Path } from '../walker/nodes.ts';
import type { LocatedEndpoint } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';

const literalSegment = /^[a-z0-9-]+$/;
const paramName = /^[a-z][a-zA-Z0-9]*$/;

/** Whether a declared path is already canonical, so its identity and its params can be read. */
export function isCanonicalPath(path: unknown): path is string {
  return typeof path === 'string' && canonicalPathFailures(path, []).length === 0;
}

/** The `:names` of a path, in order, as its params must declare them. */
export function paramNamesOf(path: string): readonly string[] {
  return segmentsOf(path)
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

/** An Endpoint's identity: its method and its path with every param replaced by `{}`. */
export function identityOf(method: unknown, path: string): string {
  const segments = segmentsOf(path).map((segment) => (segment.startsWith(':') ? '{}' : segment));
  return `${String(method)} /${segments.join('/')}`;
}

/** A path that is not canonical fails, every way it breaks the grammar named. */
export function pathFailures({ at, endpoint }: LocatedEndpoint): readonly DeclarationFailure[] {
  const pathAt = [...at, 'path'];
  if (typeof endpoint.path !== 'string') {
    return [failure(pathAt, 'canonical-path', 'A path is a string')];
  }
  return canonicalPathFailures(endpoint.path, pathAt);
}

function canonicalPathFailures(path: string, at: Path): readonly DeclarationFailure[] {
  if (path === '/') {
    return [];
  }
  const failures: DeclarationFailure[] = [];
  if (!path.startsWith('/')) {
    failures.push(failure(at, 'canonical-path', `A path starts with /: ${path}`));
  }
  if (path.endsWith('/')) {
    failures.push(failure(at, 'canonical-path', `A path has no trailing slash: ${path}`));
  }
  const segments = segmentsOf(path);
  for (const segment of segments) {
    failures.push(...segmentFailures(segment, path, at));
  }
  failures.push(...duplicateParamFailures(segments, at));
  return failures;
}

function segmentFailures(segment: string, path: string, at: Path): readonly DeclarationFailure[] {
  if (segment === '') {
    return [failure(at, 'canonical-path', `A path has no empty segment: ${path}`)];
  }
  if (segment.startsWith(':')) {
    return paramName.test(segment.slice(1))
      ? []
      : [failure(at, 'canonical-path', `A path param is written :camelCase: ${segment}`)];
  }
  return literalSegment.test(segment)
    ? []
    : [
        failure(
          at,
          'canonical-path',
          `A path segment is lower-case letters, digits and dashes: ${segment}`,
        ),
      ];
}

function duplicateParamFailures(
  segments: readonly string[],
  at: Path,
): readonly DeclarationFailure[] {
  const names = segments.filter((segment) => segment.startsWith(':'));
  const repeated = names.filter((name, index) => names.indexOf(name) !== index);
  return [...new Set(repeated)].map((name) =>
    failure(at, 'duplicate-path-param', `A path param appears once: ${name}`),
  );
}

/** The segments between the slashes of a path, a leading or trailing slash dropped. */
function segmentsOf(path: string): readonly string[] {
  const inner = path.replace(/^\//, '').replace(/\/$/, '');
  return inner === '' ? [] : inner.split('/');
}
