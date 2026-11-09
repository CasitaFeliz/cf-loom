import { unbrokenLineOf } from '../lines/index.ts';
import {
  type Defs,
  defGraphOf,
  type RefNode,
  type ResolvedRef,
  type SchemaNode,
} from '../walker/index.ts';

/** The def a `ref` stands for through alias defs: a `ref` that stands for none is a bug. */
export function resolvedRefOf(ref: RefNode, defs: Defs): ResolvedRef {
  const resolved = defGraphOf(defs).resolved(ref);
  if (resolved === undefined) {
    throw noSchemaBug(ref);
  }
  return resolved;
}

/** The def a `ref` names, itself a `ref` when it is an alias def: a name with no def is a bug. */
export function namedDefOf(ref: RefNode, defs: Defs): SchemaNode {
  const def = defGraphOf(defs).def(ref.name);
  if (def === undefined) {
    throw noSchemaBug(ref);
  }
  return def;
}

function noSchemaBug(ref: RefNode): Error {
  return new Error(unbrokenLineOf(`\`ref\` to ${ref.name} reaches no schema: a bug.`));
}
