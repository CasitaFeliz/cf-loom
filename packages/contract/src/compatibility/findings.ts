import { canonicalJson, type Defs, type Path, type SchemaNode, shapeOf } from '../walker/index.ts';
import type { ShapeDifference } from './report.ts';

/** A schema of the Baseline and the proposed one at the same place. */
export type NodePair = { readonly baseline: SchemaNode; readonly proposed: SchemaNode };

/** The defs the `ref`s of each side name. */
export type BothDefs = { readonly baseline: Defs; readonly proposed: Defs };

/**
 * What comparing two nodes finds, in order: a difference at a path inside them, or a pair of nodes
 * inside them still to compare.
 */
export type Finding =
  | { readonly kind: 'found'; readonly steps: Path; readonly shape: ShapeDifference }
  | { readonly kind: 'inside'; readonly steps: Path; readonly pair: NodePair };

/** A difference in the node itself, or at the steps that lead to it from there. */
export function found(shape: ShapeDifference, steps: Path = []): Finding {
  return { kind: 'found', steps, shape };
}

/** Two nodes inside the ones compared, at the steps that lead to them. */
export function inside(baseline: SchemaNode, proposed: SchemaNode, steps: Path): Finding {
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

/** Whether two nodes have the same shape, apart from their own nullability. */
export function hasSameShape({ baseline, proposed }: NodePair): boolean {
  return shapeKeyBesidesNullability(baseline) === shapeKeyBesidesNullability(proposed);
}
