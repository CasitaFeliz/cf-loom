import type { DefOfType } from './def-types.ts';
import { inside } from './location.ts';
import type { StringNode } from './nodes.ts';
import { notAllowed, type Refused, refused } from './not-allowed.ts';
import { keyStep, valueStep } from './steps.ts';
import {
  failed,
  failuresOf,
  type Outline,
  outlineOf,
  type Reached,
  type Walked,
  type Walker,
  type Walking,
  walked,
} from './walked.ts';

/**
 * A `record` for a string key, partial or not; a record keyed by an enum or literal is a strict
 * object, which a Contract never declares. A key that is refused tells its line beside what it
 * holds, and one that is unbuilt tells none, since its fix decides what it is.
 */
export function* walkRecord(def: DefOfType<'record'>, at: Reached, walker: Walker): Walking {
  const key = yield* walker.schema(def.keyType, inside(at, keyStep));
  const value = yield* walker.schema(def.valueType, inside(at, valueStep));
  if (def.mode === 'loose') {
    return failed(failuresOf([notAllowed(at, refused.looseRecord), key, value]));
  }
  const recordKey = recordKeyOf(outlineOf(key));
  switch (recordKey.kind) {
    case 'unbuilt':
      return failed(failuresOf([key, value]));
    case 'refused':
      return failed(failuresOf([notAllowed(at, recordKey.refusal), key, value]));
    case 'string':
      return recordOf(recordKey.node, { key, value });
  }
}

/** A record of a string key, walked whole or as far as its key and value got. */
function recordOf(
  node: StringNode,
  { key, value }: { readonly key: Walked; readonly value: Walked },
): Walked {
  if (key.kind === 'not-allowed' || value.kind === 'not-allowed') {
    return failed(failuresOf([key, value]), { type: 'record', key: node, value: outlineOf(value) });
  }
  return walked({ type: 'record', key: node, value: value.value });
}

/**
 * A key that can key a `record`, or why it cannot: only a string, not nullable, can; an unbuilt key
 * that is not nullable is no key yet.
 */
type RecordKey =
  | { readonly kind: 'string'; readonly node: StringNode }
  | { readonly kind: 'refused'; readonly refusal: Refused }
  | { readonly kind: 'unbuilt' };

function recordKeyOf(key: Outline): RecordKey {
  if (key.nullable === true) {
    return { kind: 'refused', refusal: refused.nullableRecordKey };
  }
  switch (key.type) {
    case undefined:
      return { kind: 'unbuilt' };
    case 'string':
      return { kind: 'string', node: key };
    case 'enum':
      return { kind: 'refused', refusal: key.open ? refused.openRecordKey : refused.keyedRecord };
    case 'number':
    case 'boolean':
    case 'object':
    case 'record':
    case 'array':
    case 'tuple':
    case 'union':
    case 'tagged':
    case 'allOf':
    case 'json':
    case 'ref':
      return { kind: 'refused', refusal: refused.recordKey };
  }
}
