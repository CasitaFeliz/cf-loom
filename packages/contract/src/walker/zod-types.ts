import type * as core from 'zod/v4/core';
import {
  type CheckDef,
  checksOf,
  constrainArray,
  constrainNumber,
  constrainString,
  unconstrained,
} from './checks.ts';
import { walkEnum, walkTagged, walkUnion } from './choices.ts';
import { walkArray, walkTuple } from './collections.ts';
import { annotated } from './metadata.ts';
import type { Path, SchemaNode } from './nodes.ts';
import { notAllowed, refused, refusedName } from './not-allowed.ts';
import { walkIntersection, walkObject, walkRecord } from './objects.ts';
import { isJsonUnion, walkBoolean, walkLiteral, walkNumber, walkString } from './scalars.ts';
import { type Walked, type Walker, walked } from './walked.ts';

/** A zod def, as the union of every def zod declares, so a switch over its type is closed. */
export type Def = core.$ZodTypes['_zod']['def'];

/** The node a schema's own def describes, with its own checks applied. */
export function walkDefinition(schema: core.$ZodType, at: Path, walker: Walker): Walked {
  const node = nodeOf(schema, at, walker);
  if (node.kind === 'not-allowed') {
    return node;
  }
  return constrained(node.value, checksOf(schema._zod.def), at);
}

/** A node with the constraint of each check, by what its type takes. */
export function constrained(node: SchemaNode, checks: readonly CheckDef[], at: Path): Walked {
  switch (node.type) {
    case 'string':
      return constrainString(node, checks, at);
    case 'number':
      return constrainNumber(node, checks, at);
    case 'array':
      return constrainArray(node, checks, at);
    case 'boolean':
    case 'literal':
    case 'enum':
    case 'object':
    case 'record':
    case 'tuple':
    case 'union':
    case 'tagged':
    case 'allOf':
    case 'json':
    case 'ref':
      return unconstrained(node, checks, at);
  }
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: the node or refusal of each zod type
function nodeOf(schema: core.$ZodType, at: Path, walker: Walker): Walked {
  const def = schema._zod.def as Def;
  const type: string = def.type;
  switch (def.type) {
    case 'string':
      return walkString(def, at);
    case 'number':
      return walkNumber(def, at);
    case 'boolean':
      return walkBoolean(def, at);
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
      return walker.schema((schema as core.$ZodLazy)._zod.innerType, at);
    case 'nullable':
      return annotated(walker.schema(def.innerType, at), { nullable: true });
    case 'pipe':
      return notAllowed(at, pipeRefusal(def));
    case 'optional':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly':
    case 'nonoptional':
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
    case 'map':
    case 'set':
    case 'file':
    case 'promise':
    case 'function':
    case 'success':
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
