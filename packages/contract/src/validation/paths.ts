import type { ObjectNode, Path } from '../walker/nodes.ts';
import type { LocatedEndpoint } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import { camelCase, follows } from './grammars.ts';
import { paramNamesOf, segmentsOf } from './identity.ts';
import { type Nodes, slotAt } from './schemas.ts';

const literalSegment = /^[a-z0-9-]+$/;

/** Whether a declared path is already canonical, so its identity and its params can be read. */
export function isCanonicalPath(path: unknown): path is string {
  return typeof path === 'string' && canonicalPathFailures(path, []).length === 0;
}

/** A path that is not canonical fails, every way it breaks the grammar named. */
export function pathFailures({ at, endpoint }: LocatedEndpoint): readonly DeclarationFailure[] {
  if (typeof endpoint.path !== 'string') {
    return [];
  }
  return canonicalPathFailures(endpoint.path, [...at, 'path']);
}

/**
 * `params` declares exactly the `:names` of a canonical path, none of them optional, and none
 * without; a `params` that is no object or no schema is another rule's finding.
 */
export function paramsFailures(
  { at, endpoint }: LocatedEndpoint,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  const params = nodes.nodeOf(endpoint, 'input.params');
  const declared = endpoint.input?.params !== undefined;
  if (!isCanonicalPath(endpoint.path) || (declared && params === undefined)) {
    return [];
  }
  const paramsAt = slotAt(at, 'input.params');
  const names = [...new Set(paramNamesOf(endpoint.path))];
  if (names.length === 0) {
    return declared
      ? [failure(paramsAt, 'exact-params', 'A path without :names takes no params')]
      : [];
  }
  const exact = `params declares exactly the path's :names: ${names.join(', ')}`;
  if (params === undefined) {
    return [failure(paramsAt, 'exact-params', exact)];
  }
  if (params.type !== 'object') {
    return [];
  }
  const fields = Object.keys(params.fields);
  const sameNames = fields.length === names.length && names.every((name) => fields.includes(name));
  return sameNames
    ? optionalParamFailures(params, paramsAt)
    : [failure(paramsAt, 'exact-params', exact)];
}

function optionalParamFailures(params: ObjectNode, at: Path): readonly DeclarationFailure[] {
  const optional = Object.entries(params.fields).filter(([, field]) => !field.required);
  return optional.map(([name]) =>
    failure(
      [...at, 'fields', name],
      'optional-path-param',
      `A path param is never optional: ${name}`,
    ),
  );
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
    return follows(camelCase, segment.slice(1))
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
