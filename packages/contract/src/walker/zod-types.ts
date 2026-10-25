import type * as core from 'zod/v4/core';
import { checksOf, type DeclaredCheck } from './check-defs.ts';
import { constrain } from './checks.ts';
import { walkEnum, walkTagged, walkUnion } from './choices.ts';
import { walkArray, walkTuple } from './collections.ts';
import { innerOfOneLazy } from './lazy.ts';
import { annotated } from './metadata.ts';
import type { Path } from './nodes.ts';
import { notAllowed, type Refused, refused, refusedName } from './not-allowed.ts';
import { walkIntersection, walkObject, walkRecord } from './objects.ts';
import { isJsonUnion, walkLiteral } from './scalars.ts';
import { failed, failuresOf, refusedBeside, type Walked, type Walker, walked } from './walked.ts';

/** A zod def, as the union of every def zod declares, so a switch over its type is closed. */
export type Def = core.$ZodTypes['_zod']['def'];

/** The node a schema's own def describes, with its own checks judged. */
export function walkDefinition(schema: core.$ZodType, at: Path, walker: Walker): Walked {
  return withOwnChecks(schema, nodeOf(schema, at, walker), at);
}

/**
 * A schema's walk with its own checks judged, whether it built its node or failed. A format
 * schema's own check is part of its type, so a refused type's is not refused again.
 */
export function withOwnChecks(schema: core.$ZodType, walkedSchema: Walked, at: Path): Walked {
  const checks = walkedSchema.kind === 'walked' ? checksOf(schema) : checksBesideType(schema);
  return constrain(walkedSchema, checks, at);
}

function checksBesideType(schema: core.$ZodType): readonly DeclaredCheck[] {
  return checksOf(schema).filter((check) => check.def !== schema._zod.def);
}

/** The node of a schema's type; `z.coerce.*` is refused beside the node its type still builds. */
function nodeOf(schema: core.$ZodType, at: Path, walker: Walker): Walked {
  const node = nodeOfType(schema, at, walker);
  const def = schema._zod.def as Def;
  if ('coerce' in def && def.coerce === true) {
    return refusedBeside(notAllowed(at, refused.coerce), node);
  }
  return node;
}

/**
 * The node or refusal of each zod type; a type zod adds after this walker was written reaches
 * the end and is refused by its name, never walked as something it is not.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the node or refusal of each zod type
function nodeOfType(schema: core.$ZodType, at: Path, walker: Walker): Walked {
  const def = schema._zod.def as Def;
  const type: string = def.type;
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
      return refusedWrapper(refused[def.type], at, walker.schema(def.innerType, at));
    case 'map':
      return refusedMap(def, at, walker);
    case 'set':
      return refusedAround({ refusal: refused.set, inside: [def.valueType] }, at, walker);
    case 'function':
      return refusedAround(
        { refusal: refused.function, inside: [def.input, def.output] },
        at,
        walker,
      );
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
      return notAllowed(at, refused[def.type]);
    case 'template_literal':
      return notAllowed(at, refused.templateLiteral);
  }
  return notAllowed(at, refusedName(type));
}

/** `z.json()`, a discriminated union or any other union, which zod all writes as a union. */
function unionNodeOf(schema: core.$ZodUnion, at: Path, walker: Walker): Walked {
  if (isJsonUnion(schema)) {
    return walked({ type: 'json' });
  }
  if ('discriminator' in schema._zod.def) {
    return walkTagged(schema as core.$ZodDiscriminatedUnion, at, walker);
  }
  return walkUnion(schema, at, walker);
}

/**
 * A refused wrapper around one schema, which stands for that schema's node: removing the wrapper
 * leaves its checks on the schema inside, so they are judged by it.
 */
function refusedWrapper(refusal: Refused, at: Path, inner: Walked): Walked {
  return refusedBeside(notAllowed(at, refusal), inner);
}

/** A construct the walker refuses and the schemas it holds. */
type Around = { readonly refusal: Refused; readonly inside: readonly core.$ZodType[] };

/**
 * A refused construct reported beside what lies inside it: nothing inside is hidden, and a cycle
 * through it still closes, so the recursion sees every schema that lies on one.
 */
function refusedAround({ refusal, inside }: Around, at: Path, walker: Walker): Walked {
  const walkedInside = inside.map((schema) => walker.schema(schema, at));
  return failed(failuresOf([notAllowed(at, refusal), ...walkedInside]));
}

/** A refused map, reported beside its key and its value, each at its own place as a record's are. */
function refusedMap(def: core.$ZodMapDef, at: Path, walker: Walker): Walked {
  const key = walker.schema(def.keyType, [...at, 'key']);
  const value = walker.schema(def.valueType, [...at, 'value']);
  return failed(failuresOf([notAllowed(at, refused.map), key, value]));
}

/** The schemas of a pipe other than its transform, which the pipe's own refusal already names. */
function pipeSchemasOf(def: core.$ZodPipeDef): readonly core.$ZodType[] {
  return [def.in, def.out].filter((schema) => schema._zod.def.type !== 'transform');
}

function pipeRefusal(def: core.$ZodPipeDef) {
  if ('reverseTransform' in def) {
    const isStringbool = def.in._zod.def.type === 'string' && def.out._zod.def.type === 'boolean';
    return isStringbool ? refused.stringbool : refused.codec;
  }
  if (def.in._zod.def.type === 'transform') {
    return refused.preprocess;
  }
  return def.out._zod.def.type === 'transform' ? refused.transform : refused.pipe;
}
