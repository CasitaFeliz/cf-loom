import type * as core from 'zod/v4/core';
import { checksOf, type DeclaredCheck } from './check-defs.ts';
import { refusedCheck } from './check-names.ts';
import { type CheckedAt, constrain } from './checks.ts';
import { walkEnum, walkUnion } from './choices.ts';
import { walkArray, walkTuple } from './collections.ts';
import {
  type DefOfType,
  defOf,
  defTypes,
  isKnownDefType,
  isTaggedDef,
  isWalkedDef,
  pipeRefusalKeyOf,
  type RefusedDef,
  type WalkedDef,
} from './def-types.ts';
import { walkIntersection } from './intersections.ts';
import { innerOfOneLazy } from './lazy.ts';
import { inside } from './location.ts';
import { annotated } from './metadata.ts';
import { notAllowed, type Refused, refused, refusedZodType } from './not-allowed.ts';
import { walkObject } from './objects.ts';
import { walkRecord } from './records.ts';
import { isJsonUnion, walkLiteral } from './scalars.ts';
import { keyStep, valueStep } from './steps.ts';
import { walkTagged } from './variants.ts';
import {
  failed,
  failuresOf,
  type Reached,
  type ReachedSchema,
  refusedBeside,
  type Walked,
  type Walker,
  type Walking,
  walked,
} from './walked.ts';

/** The node a schema's own def describes, with its own checks judged. */
export function* walkDefinition(schema: core.$ZodType, at: Reached, walker: Walker): Walking {
  return withOwnChecks(schema, yield* nodeOf(schema, at, walker), { at, kind: 'schema' });
}

/**
 * A schema's walk with its own checks judged, whether it built its node or failed. A format
 * schema is named by its own check, so a refused type's is not judged again beside it.
 */
export function withOwnChecks(
  schema: core.$ZodType,
  walkedSchema: Walked,
  checked: CheckedAt,
): Walked {
  const checks = walkedSchema.kind === 'walked' ? checksOf(schema) : checksBesideType(schema);
  return constrain(walkedSchema, checks, checked);
}

function checksBesideType(schema: core.$ZodType): readonly DeclaredCheck[] {
  return checksOf(schema).filter((check) => check.def !== schema._zod.def);
}

/** The node of a schema's type; `z.coerce.*` is refused beside the node its type still builds. */
function* nodeOf(schema: core.$ZodType, at: Reached, walker: Walker): Walking {
  const node = yield* nodeOfType(schema, at, walker);
  const def = defOf(schema);
  if ('coerce' in def && def.coerce === true) {
    return refusedBeside(notAllowed(at, refused.coerce), node);
  }
  return node;
}

/**
 * The node or refusal of each zod type, as `defTypes` says: a type zod adds after this walker was
 * written is refused by its name, never walked as something it is not.
 */
function* nodeOfType(schema: core.$ZodType, at: Reached, walker: Walker): Walking {
  const def = defOf(schema);
  const type: string = def.type;
  if (!isKnownDefType(type)) {
    return notAllowed(at, refusedZodType(type));
  }
  if (!isWalkedDef(def)) {
    return yield* refusedNodeOf(def, at, walker);
  }
  return yield* walkedNodeOf({ schema, at }, def, walker);
}

/** The node of a def type the walk reads one from. */
function* walkedNodeOf({ schema, at }: ReachedSchema, def: WalkedDef, walker: Walker): Walking {
  switch (def.type) {
    case 'string':
      return walked({ type: 'string' });
    case 'number':
      return walked({ type: 'number' });
    case 'boolean':
      return walked({ type: 'boolean' });
    case 'literal':
      return walkLiteral(def, at);
    case 'enum':
      return walkEnum(schema as core.$ZodEnum, at);
    case 'object':
      return yield* walkObject(def, at, walker);
    case 'record':
      return yield* walkRecord(def, at, walker);
    case 'array':
      return yield* walkArray(def, at, walker);
    case 'tuple':
      return yield* walkTuple(def, at, walker);
    case 'union':
      return yield* unionNodeOf({ schema, at }, def, walker);
    case 'intersection':
      return yield* walkIntersection(def, at, walker);
    case 'lazy':
      return yield* walker.schema(innerOfOneLazy(schema), at);
    case 'nullable':
      return annotated(yield* walker.schema(def.innerType, at), { nullable: true });
  }
}

/** What a refused def is refused as: a def that is its own check, by that check, else by its type. */
function refusalOf(def: RefusedDef): Refused {
  return 'check' in def ? refusedCheck(def) : refused[defTypes[def.type].refuses];
}

/**
 * A refused def type, worded as `defTypes` says, beside what lies inside it, which is walked and
 * judged where it stands: a map's key and value sit at their own places as a record's do, a pipe's
 * transform is the pipe's own refusal.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: what lies inside each refused zod type
function* refusedNodeOf(def: RefusedDef, at: Reached, walker: Walker): Walking {
  const refusal = refusalOf(def);
  switch (def.type) {
    case 'pipe':
      return yield* refusedAround(
        { refusal: pipeRefusal(def), inside: pipeSchemasOf(def) },
        at,
        walker,
      );
    case 'optional':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly':
    case 'nonoptional':
    case 'promise':
    case 'success':
      return failed(failuresOf([notAllowed(at, refusal), yield* walker.schema(def.innerType, at)]));
    case 'map': {
      const key = yield* walker.schema(def.keyType, inside(at, keyStep));
      const value = yield* walker.schema(def.valueType, inside(at, valueStep));
      return failed(failuresOf([notAllowed(at, refusal), key, value]));
    }
    case 'set':
      return yield* refusedAround({ refusal, inside: [def.valueType] }, at, walker);
    case 'function':
      return yield* refusedAround({ refusal, inside: [def.input, def.output] }, at, walker);
    case 'transform':
    case 'custom':
    case 'date':
    case 'null':
    case 'undefined':
    case 'any':
    case 'unknown':
    case 'bigint':
    case 'symbol':
    case 'void':
    case 'never':
    case 'nan':
    case 'file':
    case 'template_literal':
      return notAllowed(at, refusal);
  }
}

/** `z.json()`, a discriminated union or any other union, which zod all writes as a union. */
function* unionNodeOf(
  { schema, at }: ReachedSchema,
  def: DefOfType<'union'>,
  walker: Walker,
): Walking {
  if (isJsonUnion(schema, def)) {
    return walked({ type: 'json' });
  }
  if (isTaggedDef(def)) {
    return yield* walkTagged(def, at, walker);
  }
  return yield* walkUnion(def, at, walker);
}

/** A construct the walker refuses and the values it holds in place of schemas. */
type Around = { readonly refusal: Refused; readonly inside: readonly unknown[] };

/**
 * A refused construct reported beside what lies inside it: nothing inside is hidden, and a cycle
 * through it still closes, so the recursion sees every schema that lies on one.
 */
function* refusedAround({ refusal, inside }: Around, at: Reached, walker: Walker): Walking {
  const walkedInside: Walked[] = [];
  for (const schema of inside) {
    walkedInside.push(yield* walker.schema(schema, at));
  }
  return failed(failuresOf([notAllowed(at, refusal), ...walkedInside]));
}

/**
 * The ends of a pipe other than its transform, which the pipe's own refusal already names; an end
 * that is no zod 4 schema is entered, where it is refused.
 */
function pipeSchemasOf(def: DefOfType<'pipe'>): readonly unknown[] {
  return [def.in, def.out].filter((end) => defOf(end)?.type !== 'transform');
}

/** A pipe refused as `pipeRefusals` reads its shape. */
function pipeRefusal(def: DefOfType<'pipe'>): Refused {
  const shape = {
    reversed: 'reverseTransform' in def,
    in: defOf(def.in)?.type,
    out: defOf(def.out)?.type,
  };
  return refused[pipeRefusalKeyOf(shape)];
}
