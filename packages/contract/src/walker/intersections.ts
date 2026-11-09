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
  unbuilt,
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
 * Two objects merged: a shared field is compared only when both are whole, and one not compared
 * is unbuilt in the merged object; a shared field that differs refuses the intersection.
 */
function mergedObjects(
  { left, right }: ObjectPair,
  at: Reached,
  items: Walked<readonly SchemaNode[]>,
): Walked {
  const shared = Object.keys(left.fields).filter((key) => Object.hasOwn(right.fields, key));
  if (shared.some((key) => differsAt(key, left, right))) {
    return failed(failuresOf([notAllowed(at, refused.differingIntersection), items]));
  }
  const merged = mergedOf(left, right, shared);
  return items.kind === 'walked' ? wholeObject(merged) : failed(items.tree, merged);
}

/** The object two objects merge to, a shared field that was not compared being unbuilt. */
function mergedOf(
  left: ObjectOutline,
  right: ObjectOutline,
  shared: readonly string[],
): ObjectOutline {
  const fields: Record<string, FieldOf<Outline>> = { ...right.fields, ...left.fields };
  for (const key of shared) {
    const [leftField, rightField] = [left.fields[key], right.fields[key]];
    if (!isWhole(leftField?.schema) || !isWhole(rightField?.schema)) {
      const required = leftField?.required === true && rightField?.required === true;
      fields[key] = { required, schema: unbuilt };
    }
  }
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

/** Two declarations of one field, both whole, disagree on whether it is required or on its shape. */
function differsAt(key: string, left: ObjectOutline, right: ObjectOutline): boolean {
  const [leftField, rightField] = [left.fields[key], right.fields[key]];
  if (leftField === undefined || rightField === undefined) {
    return false;
  }
  const [leftSchema, rightSchema] = [leftField.schema, rightField.schema];
  if (!isWhole(leftSchema) || !isWhole(rightSchema)) {
    return false;
  }
  return (
    leftField.required !== rightField.required || shapeKey(leftSchema) !== shapeKey(rightSchema)
  );
}
