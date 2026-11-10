import type { DefOfType } from './def-types.ts';
import { inside } from './location.ts';
import type { SchemaNode } from './nodes.ts';
import { indexStep, itemsStep, restStep } from './steps.ts';
import {
  allWalked,
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

/** An array of one item schema, before its length checks. */
export function* walkArray(def: DefOfType<'array'>, at: Reached, walker: Walker): Walking {
  const items = yield* walker.schema(def.element, inside(at, itemsStep));
  if (items.kind === 'not-allowed') {
    return failed(items.tree, { type: 'array', items: outlineOf(items) });
  }
  return walked({ type: 'array', items: items.value });
}

/** A tuple, its items in their declared order, and the schema of any further items as `rest`. */
export function* walkTuple(def: DefOfType<'tuple'>, at: Reached, walker: Walker): Walking {
  const walkedItems: Walked[] = [];
  for (const [index, item] of def.items.entries()) {
    walkedItems.push(yield* walker.schema(item, inside(at, indexStep(index))));
  }
  const items = allWalked(walkedItems);
  const rest: Walked<SchemaNode | undefined> =
    def.rest === null ? walked(undefined) : yield* walker.schema(def.rest, inside(at, restStep));
  if (items.kind === 'not-allowed' || rest.kind === 'not-allowed') {
    const kept = { type: 'tuple', items: walkedItems.map(outlineOf) } as const;
    return failed(failuresOf([items, rest]), keptWithRest(kept, rest));
  }
  if (rest.value === undefined) {
    return walked({ type: 'tuple', items: items.value });
  }
  return walked({ type: 'tuple', items: items.value, rest: rest.value });
}

/** The tuple a failed walk kept, with the outline of its `rest` when it has one. */
function keptWithRest(
  kept: { readonly type: 'tuple'; readonly items: readonly Outline[] },
  rest: Walked<SchemaNode | undefined>,
): Outline {
  if (rest.kind === 'walked') {
    return rest.value === undefined ? kept : { ...kept, rest: rest.value };
  }
  return { ...kept, rest: outlineOf(rest) };
}
