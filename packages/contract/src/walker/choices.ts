import type * as core from 'zod/v4/core';
import { isOpen } from '../open/index.ts';
import { canonicalJson, inCanonicalJsonOrder, isJsonPrimitive } from './canonical-json.ts';
import type { DefOfType, TaggedDef } from './def-types.ts';
import { type Discriminator, discriminatorOf } from './discriminators.ts';
import { inside } from './location.ts';
import type {
  EnumNode,
  JsonPrimitive,
  ObjectNode,
  RefNode,
  SchemaNode,
  TaggedNode,
} from './nodes.ts';
import { notAllowed, refused } from './not-allowed.ts';
import { optionStep, type Step, variantStep } from './steps.ts';
import {
  allWalked,
  failed,
  failuresOf,
  type Outline,
  outlineOf,
  type Reached,
  type ReachedChild,
  type Visit,
  type Walked,
  type Walker,
  type Walking,
  walked,
} from './walked.ts';

/** An enum of string values, open when `openEnum()` declared it or zod derived it from one. */
export function walkEnum(schema: core.$ZodEnum, at: Reached): Walked {
  const values: readonly unknown[] = Object.values(schema._zod.def.entries);
  const strings = values.filter(isString);
  if (strings.length !== values.length) {
    return notAllowed(at, refused.numericEnum);
  }
  const closed = enumOf(strings, at);
  if (closed.kind === 'not-allowed') {
    return failed(closed.tree);
  }
  return walked({ ...closed.value, open: isOpen(schema) });
}

/** An `enum` for a union of literals, else a `union` of its options in declared order. */
export function* walkUnion(def: DefOfType<'union'>, at: Reached, walker: Walker): Walking {
  if (def.options.length === 0) {
    return notAllowed(at, refused.emptyUnion);
  }
  const walkedOptions: Walked[] = [];
  for (const [index, option] of def.options.entries()) {
    walkedOptions.push(yield* walker.schema(option, inside(at, optionStep(index))));
  }
  const options = allWalked(walkedOptions);
  if (def.inclusive === false) {
    return failed(failuresOf([notAllowed(at, refused.xor), options]));
  }
  if (options.kind === 'not-allowed') {
    return failed(options.tree, unionOutlineOf(walkedOptions.map(outlineOf)));
  }
  return choiceOf(options.value, at);
}

/**
 * What a union that failed was building: a union of every option's outline, or nothing built when
 * its options other than unbuilt ones are all closed literals, since the fix of an unbuilt option
 * decides between an enum and a union, as `choiceOf` decides.
 */
function unionOutlineOf(options: readonly Outline[]): Outline | undefined {
  const built = options.filter((option) => option.type !== undefined);
  return built.every(isClosedEnum) ? undefined : { type: 'union', options };
}

/** A `tagged` node, its variants keyed by the canonical JSON of their discriminator value. */
export function* walkTagged(def: TaggedDef, at: Reached, walker: Walker): Walking {
  if (def.options.length === 0) {
    return notAllowed(at, refused.emptyDiscriminatedUnion);
  }
  const read = def.options.map((option) => ({
    option,
    discriminator: discriminatorOf(option, def.discriminator),
  }));
  const duplicate = hasDuplicateValue(read.map(({ discriminator }) => discriminator))
    ? [notAllowed(at, refused.duplicateDiscriminatorValue)]
    : [];
  const walkedVariants: WalkedVariant[] = [];
  for (const [index, { option, discriminator }] of read.entries()) {
    const step = variantStepOf(def.discriminator, discriminator.values, index);
    const variant = { schema: option, at: walker.reach(option, inside(at, step)), discriminator };
    walkedVariants.push(yield* walkVariant(variant, walker));
  }
  const variants = allWalked(walkedVariants.map(({ entry }) => entry));
  if (duplicate.length > 0) {
    return failed(failuresOf([...duplicate, variants]));
  }
  if (variants.kind === 'not-allowed') {
    const kept = walkedVariants.map(({ kept: entry }) => entry).filter(isKept);
    const outline = { type: 'tagged', discriminator: def.discriminator } as const;
    return failed(variants.tree, { ...outline, variants: Object.fromEntries(kept) });
  }
  return walked({
    type: 'tagged',
    discriminator: def.discriminator,
    variants: Object.fromEntries(variants.value),
  });
}

/** A variant of a discriminated union where it sits, and what it says of its discriminator. */
type Variant = ReachedChild & { readonly discriminator: Discriminator };

/** A variant walked: its entry, or its refusals, and the outline it keeps under its discriminator value, if it has one. */
type WalkedVariant = {
  readonly entry: Walked<[string, TaggedNode['variants'][string]]>;
  readonly kept: readonly [string, Outline] | undefined;
};

function isKept(kept: readonly [string, Outline] | undefined): kept is readonly [string, Outline] {
  return kept !== undefined;
}

/** A variant keyed by its discriminator value, or refused beside what it holds when it cannot be. */
function* walkVariant(
  { schema, at, discriminator }: Variant,
  walker: Walker,
): Generator<Visit, WalkedVariant, Walked> {
  const variant = yield* walker.schema(schema, at);
  if (discriminator.refusal !== undefined) {
    const entry = failed(failuresOf([notAllowed(at, discriminator.refusal), variant]));
    return { entry, kept: undefined };
  }
  const key = variantKeyOf(discriminator.values);
  const kept = key === undefined ? undefined : ([key, outlineOf(variant)] as const);
  return { entry: taggedVariant(variant, discriminator.values, at), kept };
}

/**
 * Whether two variants share a discriminator value, as zod reads each variant's values: judged
 * before the variants are walked, so it is told beside what they refuse.
 */
function hasDuplicateValue(discriminators: readonly Discriminator[]): boolean {
  const values = discriminators.map(({ values }) => [...(values ?? [])]);
  const keys = values.filter(isOneValue).map(([value]) => canonicalJson(value));
  return new Set(keys).size !== keys.length;
}

function isOneValue(values: readonly unknown[]): values is [JsonPrimitive] {
  return values.length === 1 && isJsonPrimitive(values[0]);
}

/** The canonical JSON of a variant's one literal discriminator value, none for any other. */
function variantKeyOf(values: ReadonlySet<unknown> | undefined): string | undefined {
  const literals = [...(values ?? [])];
  const [only] = literals;
  return literals.length === 1 && isJsonPrimitive(only) ? canonicalJson(only) : undefined;
}

/** A variant is told by its discriminator's one literal, else by its position among the options. */
function variantStepOf(
  discriminator: string,
  values: ReadonlySet<unknown> | undefined,
  index: number,
): Step {
  const key = variantKeyOf(values);
  return key === undefined ? optionStep(index) : variantStep(discriminator, key);
}

/**
 * A variant keyed by its discriminator value, as zod itself reads it from the variant, so a
 * `ref` to an object def keys like the object.
 */
function taggedVariant(
  variant: Walked,
  values: ReadonlySet<unknown> | undefined,
  at: Reached,
): Walked<[string, TaggedNode['variants'][string]]> {
  if (variant.kind === 'not-allowed') {
    return variant;
  }
  const node = variant.value;
  if (!isTaggable(node)) {
    throw new Error('A variant already found to be an object walked to another node: a bug.');
  }
  const literals = [...(values ?? [])];
  if (literals.length === 0 || !literals.every(isJsonPrimitive)) {
    return notAllowed(at, refused.unliteralDiscriminator);
  }
  if (literals.length > 1) {
    return notAllowed(at, refused.severalDiscriminatorValues);
  }
  return walked([canonicalJson(literals[0]), node]);
}

function isTaggable(node: SchemaNode): node is ObjectNode | RefNode {
  return node.type === 'object' || node.type === 'ref';
}

/**
 * A union of closed literals is one enum: it carries only its own annotations, like a merged
 * intersection, and is nullable when any of its literals is. Any other union keeps its options in
 * declared order, since zod's union returns the first option that parses.
 */
function choiceOf(options: readonly SchemaNode[], at: Reached): Walked {
  const literals = options.filter(isClosedEnum);
  if (literals.length !== options.length) {
    return walked({ type: 'union', options: [...options] });
  }
  const values = enumOf(
    literals.flatMap((literal) => literal.values),
    at,
  );
  if (values.kind === 'not-allowed') {
    return failed(values.tree);
  }
  const nullable = literals.some((literal) => literal.nullable === true);
  return walked(nullable ? { ...values.value, nullable: true } : values.value);
}

/** A closed enum of literal values, each once, in canonical order; one without values is refused. */
export function enumOf(values: readonly JsonPrimitive[], at: Reached): Walked<EnumNode> {
  if (values.length === 0) {
    return notAllowed(at, refused.emptyEnum);
  }
  return walked({ type: 'enum', values: inCanonicalJsonOrder(values), open: false });
}

/** A closed enum, which is how a literal walks. */
function isClosedEnum(node: Outline): node is EnumNode {
  return node.type === 'enum' && !node.open;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
