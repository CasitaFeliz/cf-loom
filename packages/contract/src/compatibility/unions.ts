import type { ObjectNode, RefNode, TaggedNode } from '../walker/index.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import { type Finding, found, hasSameShape, inside, type NodePair } from './findings.ts';

/**
 * How two discriminated unions differ. Variants are matched by discriminator value alone, so a
 * changed value is a variant removed and one added, and when the discriminator itself is renamed no
 * variant is matched and nothing inside them is compared.
 */
export function taggedFindingsOf(baseline: TaggedNode, proposed: TaggedNode): readonly Finding[] {
  if (baseline.discriminator !== proposed.discriminator) {
    const change = { from: baseline.discriminator, to: proposed.discriminator };
    return [found({ kind: 'discriminator-changed', ...change })];
  }
  return counterpartsOf(baseline.variants, proposed.variants).map(variantFindingOf);
}

function variantFindingOf(variant: Counterpart<ObjectNode | RefNode>): Finding {
  const steps = ['variants', variant.key];
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
 * How two plain unions differ: any change to their options is Breaking, since none can be proven
 * compatible. Their options compare in shape order, which a Neutral annotation cannot change.
 */
export function unionFindingsOf(pair: NodePair): readonly Finding[] {
  return hasSameShape(pair) ? [] : [found({ kind: 'union-changed' })];
}
