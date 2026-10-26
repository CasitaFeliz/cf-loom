import type { Step } from '../walker/index.ts';
import { canonicalJson, type Defs, type SchemaNode, shapeOf } from '../walker/index.ts';
import type { ShapeDifference } from './shape-differences.ts';

/** A schema of the Baseline and the proposed one at the same place. */
export type NodePair = { readonly baseline: SchemaNode; readonly proposed: SchemaNode };

/** A pair of nodes of one type, which a check of that type narrows to. */
export type NodePairOf<Type extends SchemaNode['type']> = {
  readonly baseline: Extract<SchemaNode, { readonly type: Type }>;
  readonly proposed: Extract<SchemaNode, { readonly type: Type }>;
};

/** The defs the `ref`s of each side name. */
export type BothDefs = { readonly baseline: Defs; readonly proposed: Defs };

/** The defs of the Baseline's Snapshot and of the proposed one, which their schemas' `ref`s name. */
export function bothDefsOf(
  baseline: { readonly defs: Defs },
  proposed: { readonly defs: Defs },
): BothDefs {
  return { baseline: baseline.defs, proposed: proposed.defs };
}

/**
 * What comparing two nodes finds, in order: a difference at a path inside them, or a pair of nodes
 * inside them still to compare.
 */
export type Finding =
  | { readonly kind: 'found'; readonly steps: readonly Step[]; readonly shape: ShapeDifference }
  | { readonly kind: 'inside'; readonly steps: readonly Step[]; readonly pair: NodePair };

/** A difference in the node itself, or at the steps that lead to it from there. */
export function found(shape: ShapeDifference, steps: readonly Step[] = []): Finding {
  return { kind: 'found', steps, shape };
}

/** Two nodes inside the ones compared, at the steps that lead to them. */
export function inside(
  baseline: SchemaNode,
  proposed: SchemaNode,
  steps: readonly Step[],
): Finding {
  return { kind: 'inside', steps, pair: { baseline, proposed } };
}

/** The difference between two nodes of different types. */
export function typeChanged({ baseline, proposed }: NodePair): Finding {
  return found({ kind: 'type-changed', from: baseline.type, to: proposed.type });
}

/**
 * The canonical JSON of a node's shape without its own nullability, which is compared apart from
 * the shape, and without any Neutral annotation.
 */
export function shapeKeyBesidesNullability(node: SchemaNode): string {
  const shape = Object.entries(shapeOf(node)).filter(([key]) => key !== 'nullable');
  return canonicalJson(Object.fromEntries(shape));
}
