import type * as core from 'zod/v4/core';
import type { Def } from './def-types.ts';
import type { Place } from './location.ts';
import {
  annotatedBy,
  hasOwnId,
  type Metadata,
  metadataOf,
  withExamplesParsed,
} from './metadata.ts';
import type { Field, NotAllowed, Origin, SchemaNode } from './nodes.ts';
import { notAllowed, refusedWrapperId } from './not-allowed.ts';
import { compositionOf } from './open-compositions.ts';
import { type Recursion, startRecursion } from './recursion.ts';
import {
  type Composition,
  type LocatedSchema,
  type Memo,
  type Reached,
  type ReachedSchema,
  refusedBeside,
  type Under,
  type Walked,
  type Walker,
  walked,
} from './walked.ts';
import { walkDefinition, withOwnChecks } from './zod-types.ts';

/** Where a schema came from, as the caller knows it from the Definitions Packages installed. */
export type OriginOf = (schema: core.$ZodType) => Origin | undefined;

/** One schema walked where it sits: its node, or every construct in it that is not allowed. */
export type WalkedLocation = { readonly at: Place; readonly walked: Walked };

/**
 * Every schema of a Snapshot walked, each at its location in the order given, with the `defs`
 * their cycles share; one schema's failure hides nothing of the others.
 */
export type WalkedSchemas = {
  readonly located: readonly WalkedLocation[];
  readonly defs: Defs;
  /** The remembered schema each refusal was raised inside, so the fold tells it where that schema is reached. */
  readonly memoOf: ReadonlyMap<NotAllowed, Memo>;
};

/** Every schema of a Snapshot walked, where the walk first met each schema, and the compositions it built. */
export type MeetingWalk = WalkedSchemas & {
  readonly met: ReadonlyMap<core.$ZodType, Place>;
  readonly compositions: readonly Composition[];
};

/** The schemas written once under a Snapshot's `defs`, by the id that names each cycle. */
export type Defs = Readonly<Record<string, SchemaNode>>;

/** What every schema of one walk shares: how to walk inside, the recursion, origins and what was met. */
type WalkState = {
  readonly walker: Walker;
  readonly recursion: Recursion;
  readonly originOf: OriginOf;
  readonly met: Map<core.$ZodType, Place>;
  readonly compositions: Composition[];
};

/**
 * Walks every schema of one Snapshot at once, since recursion ids are unique and `defs` shared
 * across it; every construct that is not allowed is reported where it was written, and a cycle's
 * failure comes back at each place the cycle is met. Each declaration walks a cycle no id names
 * afresh, since it has no identity to share.
 */
export function walkSchemas(located: readonly LocatedSchema[], originOf: OriginOf): WalkedSchemas {
  const { located: walkedLocations, defs, memoOf } = walkMeetingSchemas(located, originOf);
  return { located: walkedLocations, defs, memoOf };
}

/**
 * Walks as `walkSchemas` does, and says where it first met each schema, so a rule can judge where
 * a schema came from, and which `allOf` and `union` nodes it built, where.
 */
export function walkMeetingSchemas(
  located: readonly LocatedSchema[],
  originOf: OriginOf,
): MeetingWalk {
  const compositions: Composition[] = [];
  const recursion = startRecursion(compositions);
  const walker: Walker = {
    schema: (schema, at) => walkSchema(schema, at, state),
    field: (schema, at) => walkField(schema, at, state),
    reach: (schema, at) => reachedAt(schema, at, state),
  };
  const state: WalkState = { walker, recursion, originOf, met: new Map(), compositions };
  let declaration: unknown;
  const walkedLocations = located.map(({ at, schema }) => {
    if (at.declaration !== declaration) {
      recursion.forgetUnnamedCycles();
      declaration = at.declaration;
    }
    return { at, walked: walker.schema(schema, at) };
  });
  return {
    located: walkedLocations,
    defs: recursion.defs(),
    memoOf: recursion.memoOf,
    met: state.met,
    compositions,
  };
}

/** The place a schema is entered at: the place given, the schema and its origin, else the nearest one around. */
function reachedAt(schema: core.$ZodType, at: Under, state: WalkState): Reached {
  return withOrigin(schema, at, state.originOf(schema));
}

function withOrigin(schema: core.$ZodType, at: Under, own: Origin | undefined): Reached {
  return { ...at, schema, origin: own ?? at.origin };
}

function walkSchema(schema: core.$ZodType, under: Under, state: WalkState): Walked {
  const own = state.originOf(schema);
  const at = withOrigin(schema, under, own);
  if (!state.met.has(schema)) {
    state.met.set(schema, at);
  }
  const metadata = ownMetadata(schema, at, own);
  const id = metadata.kind === 'walked' ? metadata.value.id : undefined;
  return state.recursion.within({ schema, at, id }, () => {
    const annotatedNode = annotatedBy(walkDefinition(schema, at, state.walker), metadata);
    const node = withExamplesParsed(schema, annotatedNode, at);
    recordComposition(node, at, state);
    return node;
  });
}

/** A node the walk built that is an `allOf` or a `union`, which a rule judges once the defs are known. */
function recordComposition(node: Walked, at: Reached, { compositions }: WalkState): void {
  if (node.kind === 'walked' && (node.value.type === 'allOf' || node.value.type === 'union')) {
    compositions.push(compositionOf(at, node.value));
  }
}

/** A field: `.optional()` directly on it makes it not required; `.required()` undoes that. */
function walkField(schema: core.$ZodType, under: Under, state: WalkState): Walked<Field> {
  const def = schema._zod.def as Def;
  if (def.type === 'optional') {
    const inner = walkSchema(def.innerType, under, state);
    return optionalField(
      throughWrapper(wrapperOf({ schema, under, kind: def.type }, state), inner),
    );
  }
  if (def.type === 'nonoptional') {
    const inner = walkRequired(def.innerType, under, state);
    return requiredField(
      throughWrapper(wrapperOf({ schema, under, kind: def.type }, state), inner),
    );
  }
  return requiredField(walkSchema(schema, under, state));
}

function walkRequired(schema: core.$ZodType, under: Under, state: WalkState): Walked {
  const def = schema._zod.def as Def;
  if (def.type !== 'optional') {
    return walkSchema(schema, under, state);
  }
  const inner = walkSchema(def.innerType, under, state);
  return throughWrapper(wrapperOf({ schema, under, kind: def.type }, state), inner);
}

/** A field's `.optional()` or `.nonoptional()`, where it sits and which of the two it is. */
type Wrapper = ReachedSchema & {
  readonly kind: 'optional' | 'nonoptional';
  readonly origin: Origin | undefined;
};

function wrapperOf(
  { schema, under, kind }: { schema: core.$ZodType; under: Under; kind: Wrapper['kind'] },
  state: WalkState,
): Wrapper {
  const origin = state.originOf(schema);
  return { schema, at: withOrigin(schema, under, origin), kind, origin };
}

/**
 * A field's wrapper says what any schema does: its checks and its own metadata apply. It names no
 * cycle, so an id on it is refused beside whatever the schema inside fails by.
 */
function throughWrapper(wrapper: Wrapper, inner: Walked): Walked {
  const { schema, at, kind, origin } = wrapper;
  const checked = withOwnChecks(schema, inner, { at, kind });
  const joined = hasOwnId(schema)
    ? refusedBeside(notAllowed(at, refusedWrapperId(kind)), checked)
    : checked;
  const annotatedNode = annotatedBy(joined, ownMetadata(schema, at, origin));
  return withExamplesParsed(schema, annotatedNode, at);
}

function requiredField(result: Walked): Walked<Field> {
  return result.kind === 'walked' ? walked({ required: true, schema: result.value }) : result;
}

function optionalField(result: Walked): Walked<Field> {
  return result.kind === 'walked' ? walked({ required: false, schema: result.value }) : result;
}

/** What the schema itself says of its node: its metadata, and the origin it has itself. */
function ownMetadata(
  schema: core.$ZodType,
  at: Reached,
  origin: Origin | undefined,
): Walked<Metadata> {
  const metadata = metadataOf(schema, at);
  if (metadata.kind === 'not-allowed' || origin === undefined) {
    return metadata;
  }
  const annotations = { ...metadata.value.annotations, origin };
  return walked({ ...metadata.value, annotations });
}
