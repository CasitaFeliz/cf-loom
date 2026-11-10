import { prototypeNames } from '../declarations/index.ts';
import { catchallRefusalKeyOf, type DefOfType, defOf } from './def-types.ts';
import { inside } from './location.ts';
import type { Field, FieldOf } from './nodes.ts';
import { notAllowed, type Refused, refused, refusedObjectNameField } from './not-allowed.ts';
import { fieldStep } from './steps.ts';
import {
  allWalked,
  failed,
  failuresOf,
  type Outline,
  type Reached,
  type ReachedChild,
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

function walkedEntry(
  key: string,
  field: Walked<Field, FieldOf<Outline>>,
): Walked<[string, Field], FieldOf<Outline>> {
  return field.kind === 'walked' ? walked([key, field.value]) : field;
}
