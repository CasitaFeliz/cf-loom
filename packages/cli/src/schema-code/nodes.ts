import { byCodePoint, type SchemaNode } from '@casitafeliz/loom-contract/internal';

/** A Snapshot node of one type. */
export type NodeOf<Type extends SchemaNode['type']> = Extract<SchemaNode, { readonly type: Type }>;

/**
 * A map of a node, its fields or variants, in code point order of its keys, so generated code
 * is a function of the canonical Snapshot whatever order JavaScript keeps keys in.
 */
export function entriesOf<Value>(map: Readonly<Record<string, Value>>): readonly [string, Value][] {
  return Object.entries(map).sort(([left], [right]) => byCodePoint(left, right));
}
