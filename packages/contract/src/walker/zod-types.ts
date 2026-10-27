import type * as core from 'zod/v4/core';
import { checksOf, type DeclaredCheck } from './check-defs.ts';
import { type CheckedAt, constrain } from './checks.ts';
import { walkEnum, walkTagged, walkUnion } from './choices.ts';
import { walkArray, walkTuple } from './collections.ts';
import {
  type Def,
  defTypes,
  isKnownDefType,
  isWalkedDef,
  pipeRefusalKeyOf,
  type RefusedDef,
  type WalkedDef,
} from './def-types.ts';
import { innerOfOneLazy } from './lazy.ts';
import { inside } from './location.ts';
import { annotated } from './metadata.ts';
import { notAllowed, type Refused, refused, refusedName } from './not-allowed.ts';
import { walkIntersection, walkObject, walkRecord } from './objects.ts';
import { isJsonUnion, walkLiteral } from './scalars.ts';
import { keyStep, valueStep } from './steps.ts';
import {
  failed,
  failuresOf,
  type Reached,
  type ReachedSchema,
  refusedBeside,
  type Walked,
  type Walker,
  walked,
} from './walked.ts';

/** The node a schema's own def describes, with its own checks judged. */
export function walkDefinition(schema: core.$ZodType, at: Reached, walker: Walker): Walked {
  return withOwnChecks(schema, nodeOf(schema, at, walker), { at, kind: 'schema' });
}

/**
 * A schema's walk with its own checks judged, whether it built its node or failed. A format
 * schema's own check is part of its type, so a refused type's is not refused again.
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
function nodeOf(schema: core.$ZodType, at: Reached, walker: Walker): Walked {
  const node = nodeOfType(schema, at, walker);
  const def = schema._zod.def as Def;
  if ('coerce' in def && def.coerce === true) {
    return refusedBeside(notAllowed(at, refused.coerce), node);
  }
  return node;
}

/**
 * The node or refusal of each zod type, as `defTypes` says: a type zod adds after this walker was
 * written is refused by its name, never walked as something it is not.
 */
function nodeOfType(schema: core.$ZodType, at: Reached, walker: Walker): Walked {
  const def = schema._zod.def as Def;
  const type: string = def.type;
  if (!isKnownDefType(type)) {
    return notAllowed(at, refusedName(type));
  }
  return isWalkedDef(def)
    ? walkedNodeOf({ schema, at }, def, walker)
    : refusedNodeOf(def, at, walker);
}

/** The node of a def type the walk reads one from. */
function walkedNodeOf({ schema, at }: ReachedSchema, def: WalkedDef, walker: Walker): Walked {
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
      return walkObject(def, at, walker);
    case 'record':
      return walkRecord(def, at, walker);
    case 'array':
      return walkArray(def, at, walker);
    case 'tuple':
      return walkTuple(def, at, walker);
    case 'union':
      return unionNodeOf(schema as core.$ZodUnion, at, walker);
    case 'intersection':
      return walkIntersection(def, at, walker);
    case 'lazy':
      return walker.schema(innerOfOneLazy(schema as core.$ZodLazy), at);
    case 'nullable':
      return annotated(walker.schema(def.innerType, at), { nullable: true });
  }
}

/**
 * A refused def type, worded as `defTypes` says, beside what lies inside it: a wrapper stands for
 * the schema inside, a map's key and value sit at their own places as a record's do, a pipe's
 * transform is the pipe's own refusal.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: what lies inside each refused zod type
function refusedNodeOf(def: RefusedDef, at: Reached, walker: Walker): Walked {
  const refusal = refused[defTypes[def.type].refuses];
  switch (def.type) {
    case 'pipe':
      return refusedAround({ refusal: pipeRefusal(def), inside: pipeSchemasOf(def) }, at, walker);
    case 'optional':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly':
    case 'nonoptional':
    case 'promise':
    case 'success':
      return refusedBeside(notAllowed(at, refusal), walker.schema(def.innerType, at));
    case 'map':
      return failed(
        failuresOf([
          notAllowed(at, refusal),
          walker.schema(def.keyType, inside(at, keyStep)),
          walker.schema(def.valueType, inside(at, valueStep)),
        ]),
      );
    case 'set':
      return refusedAround({ refusal, inside: [def.valueType] }, at, walker);
    case 'function':
      return refusedAround({ refusal, inside: [def.input, def.output] }, at, walker);
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
function unionNodeOf(schema: core.$ZodUnion, at: Reached, walker: Walker): Walked {
  if (isJsonUnion(schema)) {
    return walked({ type: 'json' });
  }
  if ('discriminator' in schema._zod.def) {
    return walkTagged(schema as core.$ZodDiscriminatedUnion, at, walker);
  }
  return walkUnion(schema, at, walker);
}

/** A construct the walker refuses and the schemas it holds. */
type Around = { readonly refusal: Refused; readonly inside: readonly core.$ZodType[] };

/**
 * A refused construct reported beside what lies inside it: nothing inside is hidden, and a cycle
 * through it still closes, so the recursion sees every schema that lies on one.
 */
function refusedAround({ refusal, inside }: Around, at: Reached, walker: Walker): Walked {
  const walkedInside = inside.map((schema) => walker.schema(schema, at));
  return failed(failuresOf([notAllowed(at, refusal), ...walkedInside]));
}

/** The schemas of a pipe other than its transform, which the pipe's own refusal already names. */
function pipeSchemasOf(def: core.$ZodPipeDef): readonly core.$ZodType[] {
  return [def.in, def.out].filter((schema) => schema._zod.def.type !== 'transform');
}

/** A pipe refused as `pipeRefusals` reads its shape. */
function pipeRefusal(def: core.$ZodPipeDef): Refused {
  const shape = {
    reversed: 'reverseTransform' in def,
    in: def.in._zod.def.type,
    out: def.out._zod.def.type,
  };
  return refused[pipeRefusalKeyOf(shape)];
}
