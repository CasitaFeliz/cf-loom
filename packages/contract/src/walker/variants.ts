import { canonicalJson, isJsonPrimitive } from './canonical-json.ts';
import type { TaggedDef } from './def-types.ts';
import { type Discriminator, discriminatorOf } from './discriminators.ts';
import { inside } from './location.ts';
import type { ObjectNode, RefNode, SchemaNode, TaggedNode } from './nodes.ts';
import { notAllowed, type Refused, refused } from './not-allowed.ts';
import { optionStep, type Step, variantStep } from './steps.ts';
import {
  allWalked,
  failed,
  failuresOf,
  isWhole,
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
    const reached = walker.reach(option, inside(at, step));
    const variant = { schema: option, at: reached, discriminator, field: def.discriminator };
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

/** A variant of a discriminated union where it sits, what it says of its discriminator, and which field that is. */
type Variant = ReachedChild & { readonly discriminator: Discriminator; readonly field: string };

/** A variant walked: its entry, or its refusals, and the outline it keeps under its discriminator value, if it has one. */
type WalkedVariant = {
  readonly entry: Walked<[string, TaggedNode['variants'][string]]>;
  readonly kept: readonly [string, Outline] | undefined;
};

function isKept(kept: readonly [string, Outline] | undefined): kept is readonly [string, Outline] {
  return kept !== undefined;
}

/** What the values a variant's discriminator takes make of it: its key, or why it has none. */
type VariantKey =
  | { readonly kind: 'keyed'; readonly key: string }
  | { readonly kind: 'refused'; readonly refusal: Refused };

function variantKeyOf(values: ReadonlySet<unknown> | undefined): VariantKey {
  const literals = [...(values ?? [])];
  if (literals.length === 0 || !literals.every(isJsonPrimitive)) {
    return { kind: 'refused', refusal: refused.unliteralDiscriminator };
  }
  const [only] = literals;
  if (literals.length !== 1 || only === undefined) {
    return { kind: 'refused', refusal: refused.severalDiscriminatorValues };
  }
  return { kind: 'keyed', key: canonicalJson(only) };
}

function isKeyed(key: VariantKey): key is Extract<VariantKey, { readonly kind: 'keyed' }> {
  return key.kind === 'keyed';
}

/** A variant keyed by its discriminator value, or refused beside what it holds when it cannot be. */
function* walkVariant(
  { schema, at, discriminator, field }: Variant,
  walker: Walker,
): Generator<Visit, WalkedVariant, Walked> {
  const variant = yield* walker.schema(schema, at);
  if (discriminator.refusal !== undefined) {
    const entry = failed(failuresOf([notAllowed(at, discriminator.refusal), variant]));
    return { entry, kept: undefined };
  }
  const key = variantKeyOf(discriminator.values);
  const kept = isKeyed(key) ? ([key.key, outlineOf(variant)] as const) : undefined;
  return { entry: taggedVariant(variant, key, { at, field }), kept };
}

/**
 * Whether two variants share a discriminator value, as zod reads each variant's values: judged
 * before the variants are walked, so it is told beside what they refuse.
 */
function hasDuplicateValue(discriminators: readonly Discriminator[]): boolean {
  const keyed = discriminators.map(({ values }) => variantKeyOf(values)).filter(isKeyed);
  return new Set(keyed.map(({ key }) => key)).size !== keyed.length;
}

/** A variant is told by its discriminator's one literal, else by its position among the options. */
function variantStepOf(
  discriminator: string,
  values: ReadonlySet<unknown> | undefined,
  index: number,
): Step {
  const key = variantKeyOf(values);
  return isKeyed(key) ? variantStep(discriminator, key.key) : optionStep(index);
}

/**
 * A variant keyed by its discriminator value, as zod itself reads it from the variant, so a
 * `ref` to an object def keys like the object. A variant that failed is judged by the rules over
 * its discriminator's values only when its discriminator field is whole, since the fix of a
 * refused discriminator decides what its values are.
 */
function taggedVariant(
  variant: Walked,
  key: VariantKey,
  { at, field }: { readonly at: Reached; readonly field: string },
): Walked<[string, TaggedNode['variants'][string]]> {
  if (variant.kind === 'not-allowed' && !isDiscriminatorWhole(outlineOf(variant), field)) {
    return variant;
  }
  if (key.kind === 'refused') {
    return failed(failuresOf([notAllowed(at, key.refusal), variant]));
  }
  if (variant.kind === 'not-allowed') {
    return variant;
  }
  const node = variant.value;
  if (!isTaggable(node)) {
    throw new Error('A variant already found to be an object walked to another node: a bug.');
  }
  return walked([key.key, node]);
}

/** Whether a variant's discriminator field is an outline whose values its schema reads whole. */
function isDiscriminatorWhole(outline: Outline, field: string): boolean {
  return outline.type === 'object' && isWhole(outline.fields[field]?.schema);
}

function isTaggable(node: SchemaNode): node is ObjectNode | RefNode {
  return node.type === 'object' || node.type === 'ref';
}
