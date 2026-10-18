import type { Endpoint, Guard } from '../declarations/index.ts';
import type { Field, ObjectNode } from '../walker/index.ts';
import { inMode, objectOf, type SnapshotSources } from './context.ts';
import type { InputSnapshot } from './types.ts';

/**
 * An Endpoint's Input as a Caller must send it: its headers and query are its own plus every
 * attached Guard's demands, since the Caller sends them all on one request.
 */
export function inputOf(
  endpoint: Endpoint,
  guards: readonly Guard[],
  { nodeOf }: SnapshotSources,
): InputSnapshot {
  const own = (part: 'input.query' | 'input.headers') => objectOf(nodeOf(endpoint, part));
  const demanded = (part: 'demands.query' | 'demands.headers') =>
    guards.map((guard) => objectOf(nodeOf(guard, part)));
  const headers = mergedOf([own('input.headers'), ...demanded('demands.headers')]);
  return {
    params: inMode(objectOf(nodeOf(endpoint, 'input.params')), 'strict'),
    query: mergedOf([own('input.query'), ...demanded('demands.query')]),
    headers: inMode(headers, 'open'),
    body: nodeOf(endpoint, 'input.body'),
  };
}

/**
 * One object of every field the declarations name, in declaration order: a field declared twice
 * keeps the first declaration's schema, since the validation proved their shapes equal, and is
 * required when either requires it; a strict declaration applies to the merged set.
 */
function mergedOf(objects: readonly (ObjectNode | null)[]): ObjectNode | null {
  const declared = objects.filter(isDeclared);
  const [first] = declared;
  if (first === undefined) {
    return null;
  }
  const fieldByName = new Map<string, Field>();
  for (const object of declared) {
    for (const [name, field] of Object.entries(object.fields)) {
      const known = fieldByName.get(name);
      const required = field.required || known?.required === true;
      fieldByName.set(name, { ...(known ?? field), required });
    }
  }
  const mode = declared.some((object) => object.mode === 'strict') ? 'strict' : 'open';
  return { ...first, mode, fields: Object.fromEntries(fieldByName) };
}

function isDeclared(object: ObjectNode | null): object is ObjectNode {
  return object !== null;
}
