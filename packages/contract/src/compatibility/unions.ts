import type { ObjectNode, RefNode } from '../walker/index.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import {
  type BothDefs,
  type Finding,
  found,
  inside,
  type NodePair,
  type NodePairOf,
} from './findings.ts';
import { isUnchanged } from './refs.ts';
import type { ShapeDifference } from './report.ts';
import { variantStep } from './steps.ts';

/**
 * How two discriminated unions differ. Variants are matched by discriminator value alone, so a
 * changed value is a variant removed and one added, and when the discriminator itself is renamed no
 * variant is matched and nothing inside them is compared.
 */
export function taggedFindingsOf({ baseline, proposed }: NodePairOf<'tagged'>): readonly Finding[] {
  if (baseline.discriminator !== proposed.discriminator) {
    const change = { from: baseline.discriminator, to: proposed.discriminator };
    return [found({ kind: 'discriminator-changed', ...change })];
  }
  const variants = counterpartsOf(baseline.variants, proposed.variants);
  return variants.map((variant) => variantFindingOf(variant, baseline.discriminator));
}

function variantFindingOf(
  variant: Counterpart<ObjectNode | RefNode>,
  discriminator: string,
): Finding {
  const steps = [variantStep(discriminator, variant.key)];
  switch (variant.kind) {
    case 'added':
      return found({ kind: 'variant-added' }, steps);
    case 'removed':
      return found({ kind: 'variant-removed' }, steps);
    case 'kept':
      return inside(variant.baseline, variant.proposed, steps);
  }
}

/**
 * The plain-union rule: any change to two nodes' options or items, or to a def their `ref`s reach,
 * is the one `difference`, Breaking in every Position, since none can be proven compatible. Their
 * options compare in shape order, which a Neutral annotation cannot change.
 */
export function plainUnionFindingsOf(
  pair: NodePair,
  defs: BothDefs,
  difference: ShapeDifference,
): readonly Finding[] {
  return isUnchanged(pair, defs) ? [] : [found(difference)];
}
