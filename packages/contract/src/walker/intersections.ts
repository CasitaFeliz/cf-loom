import type { DefOfType } from './def-types.ts';
import { heldNodeOf } from './held-node.ts';
import { inside } from './location.ts';
import type { FieldOf, SchemaNode } from './nodes.ts';
import { notAllowed, refused } from './not-allowed.ts';
import { shapeKey } from './shapes.ts';
import { indexStep } from './steps.ts';
import {
  allWalked,
  failed,
  failuresOf,
  isWhole,
  type ObjectOutline,
  type Outline,
  outlineOf,
  type Reached,
  type Walked,
  type Walker,
  type Walking,
  walked,
} from './walked.ts';

/**
 * One open object for an intersection of open objects whose shared keys agree, which fails
 * otherwise; any other intersection is `allOf`.
 */
export function* walkIntersection(
  def: DefOfType<'intersection'>,
  at: Reached,
  walker: Walker,
): Walking {
  const left = yield* walker.schema(def.left, inside(at, indexStep(0)));
  const right = yield* walker.schema(def.right, inside(at, indexStep(1)));
  const items = allWalked([left, right]);
  const [leftOutline, rightOutline] = [outlineOf(left), outlineOf(right)];
  if (leftOutline.type === 'object' && rightOutline.type === 'object') {
    return mergedObjects({ left: leftOutline, right: rightOutline }, at, items);
  }
  if (items.kind === 'walked') {
    return walked(heldNodeOf({ type: 'allOf', items: items.value }, []));
  }
  return failed(items.tree, intersectionOutlineOf(leftOutline, rightOutline));
}

/**
 * What an intersection that failed was building when its items are not both objects: an `allOf` as
 * soon as an item is built and no object, whatever fills the other; nothing built when the items
 * are objects or unbuilt, since the fix of an unbuilt one decides whether the objects merge.
 */
function intersectionOutlineOf(left: Outline, right: Outline): Outline | undefined {
  const isOther = (item: Outline) => item.type !== undefined && item.type !== 'object';
  return isOther(left) || isOther(right) ? { type: 'allOf', items: [left, right] } : undefined;
}

/** The two objects an intersection holds. */
type ObjectPair = { readonly left: ObjectOutline; readonly right: ObjectOutline };

/**
 * Two objects merged when every shared field agrees. One that differs refuses the intersection,
 * and one that is not whole on both sides leaves it unbuilt, since the fix of what is refused
 * decides whether the objects merge.
 */
function mergedObjects(
  { left, right }: ObjectPair,
  at: Reached,
  items: Walked<readonly SchemaNode[]>,
): Walked {
  const shared = Object.keys(left.fields).filter((key) => Object.hasOwn(right.fields, key));
  const comparisons = shared.map((key) => comparisonAt(key, left, right));
  if (comparisons.includes('differs')) {
    return failed(failuresOf([notAllowed(at, refused.differingIntersection), items]));
  }
  if (comparisons.includes('unknown')) {
    return failed(failuresOf([items]));
  }
  const merged = mergedOf(left, right);
  return items.kind === 'walked' ? wholeObject(merged) : failed(items.tree, merged);
}

/** The object two objects merge to, the fields of the left one first where both hold a field. */
function mergedOf(left: ObjectOutline, right: ObjectOutline): ObjectOutline {
  const fields: Record<string, FieldOf<Outline>> = { ...right.fields, ...left.fields };
  const nullable = left.nullable === true && right.nullable === true;
  return { type: 'object', fields, ...(nullable && { nullable }) };
}

/** The merged object of two whole objects, which is whole itself. */
function wholeObject(merged: ObjectOutline): Walked {
  if (!isWhole(merged)) {
    throw new Error('The merge of two whole objects is not whole: a bug.');
  }
  return walked(merged);
}

/** Whether two declarations of one field agree on whether it is required and on its shape, or are not both whole. */
type Comparison = 'agrees' | 'differs' | 'unknown';

function comparisonAt(key: string, left: ObjectOutline, right: ObjectOutline): Comparison {
  const [leftField, rightField] = [left.fields[key], right.fields[key]];
  if (leftField === undefined || rightField === undefined) {
    return 'agrees';
  }
  const [leftSchema, rightSchema] = [leftField.schema, rightField.schema];
  if (!isWhole(leftSchema) || !isWhole(rightSchema)) {
    return 'unknown';
  }
  const isSame =
    leftField.required === rightField.required && shapeKey(leftSchema) === shapeKey(rightSchema);
  return isSame ? 'agrees' : 'differs';
}
