import {
  camelCase,
  exactParamsSentence,
  follows,
  noParamsSentence,
} from '../declarations/index.ts';
import { inFields, type ObjectNode, type Place } from '../walker/index.ts';
import {
  isPlainObject,
  type LocatedEndpoint,
  paramNamesOf,
  partOf,
  segmentsOf,
  slotAt,
  writtenTextOf,
} from '../written/index.ts';
import { type DeclarationFailure, failure, type Rule } from './failures.ts';
import type { Nodes } from './schemas.ts';

const literalSegment = /^[a-z0-9-]+$/;

/** Whether a declared path is already canonical, so its identity and its params can be read. */
export function isCanonicalPath(path: unknown): path is string {
  return typeof path === 'string' && pathProblemsOf(path).length === 0;
}

/** A path that is not canonical fails, every way it breaks the grammar named. */
export function pathFailures({ at, endpoint }: LocatedEndpoint): readonly DeclarationFailure[] {
  if (typeof endpoint.path !== 'string') {
    return [];
  }
  return canonicalPathFailures(endpoint.path, inFields(at, 'path'));
}

/**
 * `params` declares exactly the `:names` of a canonical path, none of them optional, and none
 * without; a `params` whose schema is no object, or no schema, and an `input` that is no object,
 * are the `not-an-object-schema`, `not-a-schema` and `not-an-object` rules' findings.
 */
export function paramsFailures(
  { at, endpoint }: LocatedEndpoint,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  const params = nodes.nodeOf(endpoint, 'input.params');
  const input: unknown = endpoint.input;
  const declared = partOf<'params'>(input).params !== undefined;
  if (!isCanonicalPath(endpoint.path) || (declared && params === undefined)) {
    return [];
  }
  if (input !== undefined && !isPlainObject(input)) {
    return [];
  }
  const paramsAt = slotAt(at, 'input.params');
  const names = [...new Set(paramNamesOf(endpoint.path))];
  if (names.length === 0) {
    return declared ? [failure(paramsAt, 'exact-params', noParamsSentence)] : [];
  }
  const exact = exactParamsSentence(names.join(', '));
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

function optionalParamFailures(params: ObjectNode, at: Place): readonly DeclarationFailure[] {
  const optional = Object.entries(params.fields).filter(([, field]) => !field.required);
  return optional.map(([name]) =>
    failure(inFields(at, name), 'optional-path-param', `A path param is never optional: ${name}`),
  );
}

/** One way a path breaks the grammar: the rule it breaks and the sentence naming it. */
type PathProblem = { readonly rule: Rule; readonly message: string };

function canonicalPathFailures(path: string, at: Place): readonly DeclarationFailure[] {
  return pathProblemsOf(path).map(({ rule, message }) => failure(at, rule, message));
}

function pathProblemsOf(path: string): readonly PathProblem[] {
  if (path === '/') {
    return [];
  }
  const problems: PathProblem[] = [];
  if (!path.startsWith('/')) {
    problems.push({
      rule: 'canonical-path',
      message: `A path starts with /: ${writtenTextOf(path)}`,
    });
  }
  if (path.endsWith('/')) {
    problems.push({
      rule: 'canonical-path',
      message: `A path has no trailing slash: ${writtenTextOf(path)}`,
    });
  }
  const segments = segmentsOf(path);
  for (const segment of segments) {
    for (const problem of segmentProblems(segment, path)) {
      problems.push(problem);
    }
  }
  for (const problem of duplicateParamProblems(segments)) {
    problems.push(problem);
  }
  return problems;
}

function segmentProblems(segment: string, path: string): readonly PathProblem[] {
  if (segment === '') {
    return [
      { rule: 'canonical-path', message: `A path has no empty segment: ${writtenTextOf(path)}` },
    ];
  }
  if (segment.startsWith(':')) {
    const message = `A path param is written :camelCase: ${writtenTextOf(segment)}`;
    return follows(camelCase, segment.slice(1)) ? [] : [{ rule: 'canonical-path', message }];
  }
  const message = `A path segment is lower-case letters, digits and dashes: ${writtenTextOf(segment)}`;
  return literalSegment.test(segment) ? [] : [{ rule: 'canonical-path', message }];
}

function duplicateParamProblems(segments: readonly string[]): readonly PathProblem[] {
  const names = segments.filter((segment) => segment.startsWith(':'));
  const repeated = names.filter((name, index) => names.indexOf(name) !== index);
  return [...new Set(repeated)].map((name) => ({
    rule: 'duplicate-path-param',
    message: `A path param appears once: ${writtenTextOf(name)}`,
  }));
}
