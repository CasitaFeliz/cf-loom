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
import { annotated, annotatedBy, type Metadata, metadataOf } from './metadata.ts';
import type { Field, NotAllowed, Origin, Path, SchemaNode } from './nodes.ts';
import { notAllowed, refused, refusedName } from './not-allowed.ts';
import { walkIntersection, walkObject, walkRecord } from './objects.ts';
import { type Recursion, startRecursion } from './recursion.ts';
import { isJsonUnion, walkBoolean, walkLiteral, walkNumber, walkString } from './scalars.ts';
import { allWalked, type LocatedSchema, type Walked, type Walker, walked } from './walked.ts';

/** Where a schema came from, as the caller knows it from the Definitions Packages it lists. */
export type OriginOf = (schema: core.$ZodType) => Origin | undefined;

/** Every schema of a Snapshot as nodes, in the order given, with the `defs` their cycles share. */
export type WalkedSchemas =
  | {
      readonly kind: 'walked';
      readonly nodes: readonly SchemaNode[];
      readonly defs: Readonly<Record<string, SchemaNode>>;
    }
  | { readonly kind: 'not-allowed'; readonly failures: readonly NotAllowed[] };

type Context = {
  readonly walker: Walker;
  readonly recursion: Recursion;
  readonly originOf: OriginOf;
};

type Def = core.$ZodTypes['_zod']['def'];

/**
 * Walks every schema of one Snapshot at once, since recursion ids are unique and `defs` shared
 * across it; every construct that is not allowed is reported, each where it was written.
 */
export function walkSchemas(located: readonly LocatedSchema[], originOf: OriginOf): WalkedSchemas {
  const recursion = startRecursion();
  const walker: Walker = {
    schema: (schema, at) => walkSchema(schema, at, context),
    field: (schema, at) => walkField(schema, at, context),
  };
  const context: Context = { walker, recursion, originOf };
  const nodes = allWalked(located.map(({ at, schema }) => walker.schema(schema, at)));
  if (nodes.kind === 'not-allowed') {
    return nodes;
  }
  return { kind: 'walked', nodes: nodes.value, defs: recursion.defs() };
}

function walkSchema(schema: core.$ZodType, at: Path, context: Context): Walked {
  const metadata = ownMetadata(schema, at, context.originOf);
  const id = metadata.kind === 'walked' ? metadata.value.id : undefined;
  return context.recursion.within({ schema, at }, id, () =>
    annotatedBy(walkDefinition(schema, at, context.walker), metadata),
  );
}

function walkField(schema: core.$ZodType, at: Path, context: Context): Walked<Field> {
  const def = schema._zod.def as Def;
  if (def.type !== 'optional') {
    return requiredField(walkSchema(schema, at, context));
  }
  const inner = walkSchema(def.innerType, at, context);
  return optionalField(throughWrapper({ schema, at }, inner, context));
}

/** A field's wrapper says what any schema does: its checks and its own metadata apply. */
function throughWrapper(wrapper: LocatedSchema, inner: Walked, context: Context): Walked {
  const { schema, at } = wrapper;
  const checks = checksOf(schema._zod.def);
  const checked = inner.kind === 'walked' ? constrained(inner.value, checks, at) : inner;
  return annotatedBy(checked, ownMetadata(schema, at, context.originOf));
}

function requiredField(result: Walked): Walked<Field> {
  return result.kind === 'walked' ? walked({ required: true, schema: result.value }) : result;
}

function optionalField(result: Walked): Walked<Field> {
  return result.kind === 'walked' ? walked({ required: false, schema: result.value }) : result;
}

/** What the schema itself says of its node: its metadata, and its origin from the caller. */
function ownMetadata(schema: core.$ZodType, at: Path, originOf: OriginOf): Walked<Metadata> {
  const metadata = metadataOf(schema, at);
  const origin = originOf(schema);
  if (metadata.kind === 'not-allowed' || origin === undefined) {
    return metadata;
  }
  const annotations = { ...metadata.value.annotations, origin };
  return walked({ ...metadata.value, annotations });
}

function walkDefinition(schema: core.$ZodType, at: Path, walker: Walker): Walked {
  const node = nodeOf(schema, at, walker);
  if (node.kind === 'not-allowed') {
    return node;
  }
  return constrained(node.value, checksOf(schema._zod.def), at);
}

function constrained(node: SchemaNode, checks: readonly CheckDef[], at: Path): Walked {
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
