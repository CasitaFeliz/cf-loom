import type * as core from 'zod/v4/core';
import type { Def } from './def-types.ts';
import {
  annotatedBy,
  hasOwnId,
  type Metadata,
  metadataOf,
  withExamplesParsed,
} from './metadata.ts';
import type { Field, Origin, Path, SchemaNode } from './nodes.ts';
import { notAllowed, refusedWrapperId } from './not-allowed.ts';
import { withNullableOnUses } from './nullable-uses.ts';
import { type Recursion, startRecursion } from './recursion.ts';
import {
  distinctFailures,
  type LocatedSchema,
  refusedBeside,
  type Walked,
  type Walker,
  walked,
} from './walked.ts';
import { walkDefinition, withOwnChecks } from './zod-types.ts';

/** Where a schema came from, as the caller knows it from the Definitions Packages installed. */
export type OriginOf = (schema: core.$ZodType) => Origin | undefined;

/** One schema walked where it sits: its node, or every construct in it that is not allowed. */
export type WalkedLocation = { readonly at: Path; readonly walked: Walked };

/**
 * Every schema of a Snapshot walked, each at its location in the order given, with the `defs`
 * their cycles share; one schema's failure hides nothing of the others.
 */
export type WalkedSchemas = {
  readonly located: readonly WalkedLocation[];
  readonly defs: Defs;
};

/** Every schema of a Snapshot walked, and every schema the walk met, at the first place it met it. */
export type MeetingWalk = WalkedSchemas & { readonly met: ReadonlyMap<core.$ZodType, Path> };

/** The schemas written once under a Snapshot's `defs`, by the id that names each cycle. */
export type Defs = Readonly<Record<string, SchemaNode>>;

/** What every schema of one walk shares: how to walk inside, the recursion, and origins. */
type WalkState = {
  readonly walker: Walker;
  readonly recursion: Recursion;
  readonly originOf: OriginOf;
  readonly met: Map<core.$ZodType, Path>;
};

/**
 * Walks every schema of one Snapshot at once, since recursion ids are unique and `defs` shared
 * across it; every construct that is not allowed is reported where it was written, and a cycle's
 * failure comes back as the same failure wherever the cycle is met.
 */
export function walkSchemas(located: readonly LocatedSchema[], originOf: OriginOf): WalkedSchemas {
  const { located: walkedLocations, defs } = walkMeetingSchemas(located, originOf);
  return { located: walkedLocations, defs };
}

/** Walks as `walkSchemas` does, and says where it first met each schema, so a rule can judge where a schema came from. */
export function walkMeetingSchemas(
  located: readonly LocatedSchema[],
  originOf: OriginOf,
): MeetingWalk {
  const recursion = startRecursion();
  const walker: Walker = {
    schema: (schema, at) => walkSchema(schema, at, state),
    field: (schema, at) => walkField(schema, at, state),
  };
  const state: WalkState = { walker, recursion, originOf, met: new Map() };
  const walkedLocations = located.map(({ at, schema }) => ({
    at,
    walked: distinct(walker.schema(schema, at)),
  }));
  const canonical = withNullableOnUses({ located: walkedLocations, defs: recursion.defs() });
  return { ...canonical, met: state.met };
}

/** A schema's failures each once, without the node the walk was building. */
function distinct(walked: Walked): Walked {
  if (walked.kind === 'walked') {
    return walked;
  }
  return { kind: 'not-allowed', failures: distinctFailures(walked.failures) };
}

function walkSchema(schema: core.$ZodType, at: Path, state: WalkState): Walked {
  if (!state.met.has(schema)) {
    state.met.set(schema, at);
  }
  const metadata = ownMetadata(schema, at, state.originOf);
  const id = metadata.kind === 'walked' ? metadata.value.id : undefined;
  return state.recursion.within({ schema, at, id }, () => {
    const annotatedNode = annotatedBy(walkDefinition(schema, at, state.walker), metadata);
    return withExamplesParsed(schema, annotatedNode, at);
  });
}

/** A field: `.optional()` directly on it makes it not required; `.required()` undoes that. */
function walkField(schema: core.$ZodType, at: Path, state: WalkState): Walked<Field> {
  const def = schema._zod.def as Def;
  if (def.type === 'optional') {
    const inner = walkSchema(def.innerType, at, state);
    return optionalField(throughWrapper({ schema, at, kind: def.type }, inner, state));
  }
  if (def.type === 'nonoptional') {
    const inner = walkRequired(def.innerType, at, state);
    return requiredField(throughWrapper({ schema, at, kind: def.type }, inner, state));
  }
  return requiredField(walkSchema(schema, at, state));
}

function walkRequired(schema: core.$ZodType, at: Path, state: WalkState): Walked {
  const def = schema._zod.def as Def;
  if (def.type !== 'optional') {
    return walkSchema(schema, at, state);
  }
  const inner = walkSchema(def.innerType, at, state);
  return throughWrapper({ schema, at, kind: def.type }, inner, state);
}

/** A field's `.optional()` or `.nonoptional()`, where it sits and which of the two it is. */
type Wrapper = LocatedSchema & { readonly kind: 'optional' | 'nonoptional' };

/**
 * A field's wrapper says what any schema does: its checks and its own metadata apply. It names no
 * cycle, so an id on it is refused beside whatever the schema inside fails by.
 */
function throughWrapper(wrapper: Wrapper, inner: Walked, state: WalkState): Walked {
  const { schema, at, kind } = wrapper;
  const checked = withOwnChecks(schema, inner, at);
  const joined = hasOwnId(schema)
    ? refusedBeside(notAllowed(at, refusedWrapperId(kind)), checked)
    : checked;
  const annotatedNode = annotatedBy(joined, ownMetadata(schema, at, state.originOf));
  return withExamplesParsed(schema, annotatedNode, at);
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
