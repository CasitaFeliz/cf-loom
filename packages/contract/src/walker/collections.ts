import type * as core from 'zod/v4/core';
import { inside } from './location.ts';
import type { SchemaNode } from './nodes.ts';
import { indexStep, itemsStep, restStep } from './steps.ts';
import {
  allWalked,
  failed,
  failuresOf,
  type Reached,
  type Walked,
  type Walker,
  type Walking,
  walked,
} from './walked.ts';

/** An array of one item schema, before its length checks. */
export function* walkArray(def: core.$ZodArrayDef, at: Reached, walker: Walker): Walking {
  const items = yield* walker.schema(def.element, inside(at, itemsStep));
  if (items.kind === 'not-allowed') {
    return failed(items.tree, { type: 'array' });
  }
  return walked({ type: 'array', items: items.value });
}

/** A tuple, its items in their declared order, and the schema of any further items as `rest`. */
export function* walkTuple(def: core.$ZodTupleDef, at: Reached, walker: Walker): Walking {
  const walkedItems: Walked[] = [];
  for (const [index, item] of def.items.entries()) {
    walkedItems.push(yield* walker.schema(item, inside(at, indexStep(index))));
  }
  const items = allWalked(walkedItems);
  const rest: Walked<SchemaNode | undefined> =
    def.rest === null ? walked(undefined) : yield* walker.schema(def.rest, inside(at, restStep));
  if (items.kind === 'not-allowed' || rest.kind === 'not-allowed') {
    return failed(failuresOf([items, rest]), { type: 'tuple' });
  }
  if (rest.value === undefined) {
    return walked({ type: 'tuple', items: items.value });
  }
  return walked({ type: 'tuple', items: items.value, rest: rest.value });
}
