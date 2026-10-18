import type * as core from 'zod/v4/core';
import { checksOf } from './check-defs.ts';
import { annotatedBy, type Metadata, metadataOf } from './metadata.ts';
import type { Field, NotAllowed, Origin, Path, SchemaNode } from './nodes.ts';
import { type Recursion, startRecursion } from './recursion.ts';
import {
  allWalked,
  distinctFailures,
  type LocatedSchema,
  type Walked,
  type Walker,
  walked,
} from './walked.ts';
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
  | { readonly kind: 'not-allowed'; readonly failures: readonly [NotAllowed, ...NotAllowed[]] };

/** What every schema of one walk shares: how to walk inside, the recursion, and origins. */
type WalkState = {
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
    schema: (schema, at) => walkSchema(schema, at, state),
    field: (schema, at) => walkField(schema, at, state),
  };
  const state: WalkState = { walker, recursion, originOf };
  const nodes = allWalked(located.map(({ at, schema }) => walker.schema(schema, at)));
  if (nodes.kind === 'not-allowed') {
    return { kind: 'not-allowed', failures: distinctFailures(nodes.failures) };
  }
  return { kind: 'walked', nodes: nodes.value, defs: recursion.defs() };
}

function walkSchema(schema: core.$ZodType, at: Path, state: WalkState): Walked {
  const metadata = ownMetadata(schema, at, state.originOf);
  const id = metadata.kind === 'walked' ? metadata.value.id : undefined;
  return state.recursion.within({ schema, at, id }, () =>
    annotatedBy(walkDefinition(schema, at, state.walker), metadata),
  );
}

/** A field: `.optional()` directly on it makes it not required; `.required()` undoes that. */
function walkField(schema: core.$ZodType, at: Path, state: WalkState): Walked<Field> {
  const def = schema._zod.def as Def;
  if (def.type === 'optional') {
    const inner = walkSchema(def.innerType, at, state);
    return optionalField(throughWrapper({ schema, at }, inner, state));
  }
  if (def.type === 'nonoptional') {
    const inner = walkRequired(def.innerType, at, state);
    return requiredField(throughWrapper({ schema, at }, inner, state));
  }
  return requiredField(walkSchema(schema, at, state));
}

function walkRequired(schema: core.$ZodType, at: Path, state: WalkState): Walked {
  const def = schema._zod.def as Def;
  if (def.type !== 'optional') {
    return walkSchema(schema, at, state);
  }
  return throughWrapper({ schema, at }, walkSchema(def.innerType, at, state), state);
}

/** A field's wrapper says what any schema does: its checks and its own metadata apply. */
function throughWrapper(wrapper: LocatedSchema, inner: Walked, state: WalkState): Walked {
  const { schema, at } = wrapper;
  const checks = checksOf(schema);
  const checked = inner.kind === 'walked' ? constrained(inner.value, checks, at) : inner;
  return annotatedBy(checked, ownMetadata(schema, at, state.originOf));
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
