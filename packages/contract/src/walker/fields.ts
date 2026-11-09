import type * as core from 'zod/v4/core';
import { defOf, isSchema } from './def-types.ts';
import { annotatedBy, hasOwnId, withExamplesParsed } from './metadata.ts';
import type { Field, FieldOf, Origin } from './nodes.ts';
import { notAllowed, refusedWrapperId } from './not-allowed.ts';
import { ownMetadata, withOrigin } from './origins.ts';
import {
  failedField,
  type Outline,
  outlineOf,
  type ReachedSchema,
  refusedBeside,
  type Under,
  type Walked,
  type Walker,
  type Walking,
  walked,
} from './walked.ts';
import { withOwnChecks } from './zod-types.ts';

/** What the walk of a field needs: how to walk inside, and where a schema came from. */
export type FieldState = {
  readonly walker: Walker;
  readonly originOf: (schema: core.$ZodType) => Origin | undefined;
};

/** A field: `.optional()` directly on it makes it not required; `.required()` undoes that. */
export function* walkField(
  schema: unknown,
  under: Under,
  state: FieldState,
): Walking<Field, FieldOf<Outline>> {
  if (!isSchema(schema)) {
    return requiredField(yield* state.walker.schema(schema, under));
  }
  const def = defOf(schema);
  if (def.type === 'optional') {
    const inner = yield* state.walker.schema(def.innerType, under);
    return optionalField(
      throughWrapper(wrapperOf({ schema, under, kind: def.type }, state), inner),
    );
  }
  if (def.type === 'nonoptional') {
    const inner = yield* walkRequired(def.innerType, under, state);
    return requiredField(
      throughWrapper(wrapperOf({ schema, under, kind: def.type }, state), inner),
    );
  }
  return requiredField(yield* state.walker.schema(schema, under));
}

function* walkRequired(schema: unknown, under: Under, state: FieldState): Walking {
  const def = defOf(schema);
  if (!isSchema(schema) || def?.type !== 'optional') {
    return yield* state.walker.schema(schema, under);
  }
  const inner = yield* state.walker.schema(def.innerType, under);
  return throughWrapper(wrapperOf({ schema, under, kind: def.type }, state), inner);
}

/** A field's `.optional()` or `.nonoptional()`, where it sits and which of the two it is. */
type Wrapper = ReachedSchema & {
  readonly kind: 'optional' | 'nonoptional';
  readonly origin: Origin | undefined;
};

function wrapperOf(
  { schema, under, kind }: { schema: core.$ZodType; under: Under; kind: Wrapper['kind'] },
  state: FieldState,
): Wrapper {
  const origin = state.originOf(schema);
  return { schema, at: withOrigin(schema, under, origin), kind, origin };
}

/**
 * A field's wrapper says what any schema does: its own metadata applies, and its checks are judged
 * as any schema's are. It names no cycle, so an id on it is refused beside whatever the schema
 * inside fails by.
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

function requiredField(result: Walked): Walked<Field, FieldOf<Outline>> {
  return fieldOf(result, true);
}

function optionalField(result: Walked): Walked<Field, FieldOf<Outline>> {
  return fieldOf(result, false);
}

/** A field walked, or failed keeping the field it was building, with the outline of its schema. */
function fieldOf(result: Walked, required: boolean): Walked<Field, FieldOf<Outline>> {
  if (result.kind === 'walked') {
    return walked({ required, schema: result.value });
  }
  return failedField(result.tree, { required, schema: outlineOf(result) });
}
