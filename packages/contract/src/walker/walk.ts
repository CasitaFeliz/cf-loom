import type * as core from 'zod/v4/core';
import { checksOf } from './check-defs.ts';
import { annotatedBy, type Metadata, metadataOf } from './metadata.ts';
import type { Field, NotAllowed, Origin, Path, SchemaNode } from './nodes.ts';
import { type Recursion, startRecursion } from './recursion.ts';
import { allWalked, type LocatedSchema, type Walked, type Walker, walked } from './walked.ts';
import { constrained, type Def, walkDefinition } from './zod-types.ts';

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
  return context.recursion.within({ schema, at, id }, () =>
    annotatedBy(walkDefinition(schema, at, context.walker), metadata),
  );
}

/** A field: `.optional()` directly on it makes it not required; `.required()` undoes that. */
function walkField(schema: core.$ZodType, at: Path, context: Context): Walked<Field> {
  const def = schema._zod.def as Def;
  if (def.type === 'optional') {
    const inner = walkSchema(def.innerType, at, context);
    return optionalField(throughWrapper({ schema, at }, inner, context));
  }
  if (def.type === 'nonoptional') {
    const inner = walkRequired(def.innerType, at, context);
    return requiredField(throughWrapper({ schema, at }, inner, context));
  }
  return requiredField(walkSchema(schema, at, context));
}

function walkRequired(schema: core.$ZodType, at: Path, context: Context): Walked {
  const def = schema._zod.def as Def;
  if (def.type !== 'optional') {
    return walkSchema(schema, at, context);
  }
  return throughWrapper({ schema, at }, walkSchema(def.innerType, at, context), context);
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
