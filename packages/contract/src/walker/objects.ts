import { prototypeNames } from '../declarations/index.ts';
import { catchallRefusalKeyOf, type DefOfType, defOf } from './def-types.ts';
import { heldNodeOf } from './held-node.ts';
import { inside } from './location.ts';
import type { Field, FieldOf, SchemaNode, StringNode } from './nodes.ts';
import { notAllowed, type Refused, refused, refusedObjectNameField } from './not-allowed.ts';
import { shapeKey } from './shapes.ts';
import { fieldStep, indexStep, keyStep, valueStep } from './steps.ts';
import {
  allWalked,
  failed,
  failuresOf,
  isWhole,
  type ObjectOutline,
  type Outline,
  outlineOf,
  type Reached,
  type ReachedChild,
  unbuilt,
  type Walked,
  type Walker,
  type Walking,
  walked,
} from './walked.ts';

/** The key zod drops when it parses, since assigning it sets the prototype instead. */
const protoKey = '__proto__';

const inheritedKeys: ReadonlySet<string> = new Set(prototypeNames);

/** An object: a Contract declares no strict object, and a catchall is refused. */
export function* walkObject(def: DefOfType<'object'>, at: Reached, walker: Walker): Walking {
  const catchall = catchallRefusalOf(def);
  const refusals = catchall === undefined ? [] : [notAllowed(at, catchall)];
  const fieldEntries: Walked<[string, Field], FieldOf<Outline>>[] = [];
  const kept: [string, FieldOf<Outline>][] = [];
  let isNameRefused = false;
  for (const [key, schema] of Object.entries(def.shape)) {
    isNameRefused ||= fieldNameRefusalOf(key) !== undefined;
    const entry = yield* walkNamedField(key, { at: inside(at, fieldStep(key)), schema }, walker);
    fieldEntries.push(entry);
    const field = keptFieldOf(entry);
    if (field !== undefined) {
      kept.push([key, field]);
    }
  }
  const fields = allWalked(fieldEntries);
  if (refusals.length > 0 || isNameRefused) {
    return failed(failuresOf([...refusals, fields]));
  }
  if (fields.kind === 'not-allowed') {
    return failed(fields.tree, { type: 'object', fields: Object.fromEntries(kept) });
  }
  return walked({ type: 'object', fields: Object.fromEntries(fields.value) });
}

/** The field a field's walk built or was building, none when it kept none. */
function keptFieldOf(
  entry: Walked<[string, Field], FieldOf<Outline>>,
): FieldOf<Outline> | undefined {
  return entry.kind === 'walked' ? entry.value[1] : entry.outline;
}

/** A field walked by its name, or refused beside what lies inside it when zod cannot read the name. */
function* walkNamedField(
  key: string,
  field: ReachedChild,
  walker: Walker,
): Walking<[string, Field], FieldOf<Outline>> {
  const refusal = fieldNameRefusalOf(key);
  if (refusal !== undefined) {
    return yield* refusedNameFailure(refusal, field, walker);
  }
  return walkedEntry(key, yield* walker.field(field.schema, field.at));
}

/** Why zod cannot read a field of this name, or undefined when it can. */
function fieldNameRefusalOf(key: string): Refused | undefined {
  if (key === protoKey) {
    return refused.protoField;
  }
  return inheritedKeys.has(key) ? refusedObjectNameField(key) : undefined;
}

/** A field zod cannot read by its name, refused beside what lies inside its schema. */
function* refusedNameFailure(
  refusal: Refused,
  { at, schema }: ReachedChild,
  walker: Walker,
): Walking<never, FieldOf<Outline>> {
  const inner = yield* walker.field(schema, at);
  return { kind: 'not-allowed', tree: failuresOf([notAllowed(at, refusal), inner]) };
}

/**
 * A `record` for a string key, partial or not; a record keyed by an enum or literal is a strict
 * object, which a Contract never declares.
 */
export function* walkRecord(def: DefOfType<'record'>, at: Reached, walker: Walker): Walking {
  const key = yield* walker.schema(def.keyType, inside(at, keyStep));
  const value = yield* walker.schema(def.valueType, inside(at, valueStep));
  if (def.mode === 'loose') {
    return failed(failuresOf([notAllowed(at, refused.looseRecord), key, value]));
  }
  if (key.kind === 'not-allowed') {
    return failed(failuresOf([key, value]));
  }
  const recordKey = recordKeyOf(key.value);
  if (recordKey.kind === 'refused') {
    return failed(failuresOf([notAllowed(at, recordKey.refusal), value]));
  }
  if (value.kind === 'not-allowed') {
    return failed(value.tree, { type: 'record', key: recordKey.node, value: outlineOf(value) });
  }
  return walked({ type: 'record', key: recordKey.node, value: value.value });
}

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

/**
 * What a catchall declares, which a Contract never does, worded as `catchalls` reads its def type;
 * a catchall that is no zod 4 schema is refused as that.
 */
function catchallRefusalOf(def: DefOfType<'object'>): Refused | undefined {
  if (def.catchall === undefined) {
    return undefined;
  }
  const catchall = defOf(def.catchall);
  return catchall === undefined ? refused.notZod4 : refused[catchallRefusalKeyOf(catchall.type)];
}

/** A walked key that can key a `record`, or why it cannot: only a string, not nullable, can. */
type RecordKey =
  | { readonly kind: 'string'; readonly node: StringNode }
  | { readonly kind: 'refused'; readonly refusal: Refused };

function recordKeyOf(key: SchemaNode): RecordKey {
  if (key.nullable === true) {
    return { kind: 'refused', refusal: refused.nullableRecordKey };
  }
  if (key.type === 'string') {
    return { kind: 'string', node: key };
  }
  if (key.type !== 'enum') {
    return { kind: 'refused', refusal: refused.recordKey };
  }
  return { kind: 'refused', refusal: key.open ? refused.openRecordKey : refused.keyedRecord };
}

function walkedEntry(
  key: string,
  field: Walked<Field, FieldOf<Outline>>,
): Walked<[string, Field], FieldOf<Outline>> {
  return field.kind === 'walked' ? walked([key, field.value]) : field;
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
