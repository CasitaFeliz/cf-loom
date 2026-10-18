import type * as core from 'zod/v4/core';
import type { Path, SchemaNode, Walked, Walker } from './nodes.ts';
import { allWalked, failuresOf, walked } from './not-allowed.ts';

/** An array of one item schema, before its length checks. */
export function walkArray(def: core.$ZodArrayDef, at: Path, walker: Walker): Walked {
  const items = walker.schema(def.element, [...at, 'items']);
  if (items.kind === 'not-allowed') {
    return items;
  }
  return walked({ type: 'array', items: items.value });
}

/** A tuple, its items in their declared order, and the schema of any further items as `rest`. */
export function walkTuple(def: core.$ZodTupleDef, at: Path, walker: Walker): Walked {
  const walkedItems = def.items.map((item, index) => walker.schema(item, [...at, 'items', index]));
  const items = allWalked(walkedItems);
  const rest: Walked<SchemaNode | undefined> =
    def.rest === null ? walked(undefined) : walker.schema(def.rest, [...at, 'rest']);
  if (items.kind === 'not-allowed' || rest.kind === 'not-allowed') {
    return { kind: 'not-allowed', failures: failuresOf([items, rest]) };
  }
  if (rest.value === undefined) {
    return walked({ type: 'tuple', items: items.value });
  }
  return walked({ type: 'tuple', items: items.value, rest: rest.value });
}
