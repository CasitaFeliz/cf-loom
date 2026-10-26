import type { Endpoint, Guard } from '../declarations/index.ts';
import type { Field, ObjectNode } from '../walker/index.ts';
import type { SnapshotSources } from './context.ts';
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
  const own = (part: 'input.query' | 'input.headers') => nodeOf(endpoint, part);
  const demanded = (part: 'demands.query' | 'demands.headers') =>
    guards.map((guard) => nodeOf(guard, part));
  const headers = mergedOf([own('input.headers'), ...demanded('demands.headers')]);
  return {
    params: nodeOf(endpoint, 'input.params') ?? null,
    query: textPartOf(mergedOf([own('input.query'), ...demanded('demands.query')])),
    headers: textPartOf(headers),
    body: nodeOf(endpoint, 'input.body') ?? null,
  };
}

/**
 * A text part as the Snapshot writes it: an open object, with no field when none is declared, so
 * a part declared empty and one not declared are the same Snapshot.
 */
export function textPartOf(part: ObjectNode | undefined): ObjectNode {
  return part ?? { type: 'object', fields: {} };
}

/**
 * One object of every field the declarations name, in declaration order: a field declared twice
 * keeps the first declaration's schema, since the validation proved their shapes equal, and is
 * required when either requires it.
 */
function mergedOf(objects: readonly (ObjectNode | undefined)[]): ObjectNode | undefined {
  const declared = objects.filter(isDeclared);
  const [first] = declared;
  if (first === undefined) {
    return undefined;
  }
  const fieldByName = new Map<string, Field>();
  for (const object of declared) {
    for (const [name, field] of Object.entries(object.fields)) {
      const known = fieldByName.get(name);
      const required = field.required || known?.required === true;
      fieldByName.set(name, { ...(known ?? field), required });
    }
  }
  return { ...first, fields: Object.fromEntries(fieldByName) };
}

function isDeclared(object: ObjectNode | undefined): object is ObjectNode {
  return object !== undefined;
}
