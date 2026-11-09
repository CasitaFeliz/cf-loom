import { joinedOf } from '../lines/index.ts';
import { type EndpointSnapshot, isDeclared, type PublishedSnapshot } from '../snapshot/index.ts';
import type { Problem } from '../validation/index.ts';
import type { ObjectNode, Path } from '../walker/index.ts';
import { endpointSegmentsOf, readEndpointIdentity } from '../written/index.ts';

/**
 * Each declared Endpoint's params as its identity fixes them: as many names as the identity has
 * `{}`, each once, and `input.params` null for a path without params and otherwise an object of
 * exactly those fields, each required. The Check matches params by position, which these make
 * mean what they say.
 */
export function paramProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  if (snapshot.kind !== 'service') {
    return [];
  }
  return Object.entries(snapshot.endpoints).flatMap(([identity, endpoint]) =>
    isDeclared(endpoint) && readEndpointIdentity(identity) !== undefined
      ? paramProblemsAt(['endpoints', identity], identity, endpoint)
      : [],
  );
}

function paramProblemsAt(
  at: Path,
  identity: string,
  { params, input }: EndpointSnapshot,
): readonly Problem[] {
  const count = endpointSegmentsOf(identity).segments.filter(({ kind }) => kind === 'param').length;
  if (params.length !== count || new Set(params).size !== params.length) {
    const reason = `names ${params.length} params where the identity has ${count}, each once`;
    return [{ at: [...at, 'params'], reason }];
  }
  const paramsAt = [...at, 'input', 'params'];
  if (count === 0) {
    const reason = 'is not null, as a path without params has';
    return input.params === null ? [] : [{ at: paramsAt, reason }];
  }
  if (input.params === null) {
    return [{ at: paramsAt, reason: 'is null, where a path with params has an object' }];
  }
  return paramFieldProblemsAt(paramsAt, params, input.params);
}

function paramFieldProblemsAt(
  at: Path,
  params: readonly string[],
  object: ObjectNode,
): readonly Problem[] {
  const named = Object.keys(object.fields).length === params.length;
  if (!named || !params.every((name) => Object.hasOwn(object.fields, name))) {
    return [{ at, reason: `declares other fields than the params: ${joinedOf(params, 'and')}` }];
  }
  return params
    .filter((name) => object.fields[name]?.required === false)
    .map((name) => ({ at: [...at, 'fields', name], reason: 'is optional: a path param never is' }));
}
