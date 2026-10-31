import {
  type Child,
  heldNodeOf,
  type NodeEdit,
  type SchemaNode,
  withoutNullable,
} from '../walker/index.ts';
import type { BothDefs, Finding } from './findings.ts';
import type { BothResolvers, GraftDefs } from './graft-names.ts';

/** Where a node the walk builds goes once it is built. */
export type Put = (node: SchemaNode) => void;

/**
 * One node being built on the walk's stack: the proposed node with a pair's findings applied, the
 * former node at hand for the fields it grafts, or a former node copied child by child. Its edits
 * are applied once the frame completes, since a copy replaces children by the index they had.
 */
export type Frame =
  | {
      readonly kind: 'graft';
      readonly former: SchemaNode;
      readonly findings: Iterator<Finding>;
      readonly owner: number | undefined;
      readonly node: SchemaNode;
      readonly edits: NodeEdit[];
      readonly put: Put;
    }
  | {
      readonly kind: 'copy';
      readonly children: Iterator<Child>;
      readonly node: SchemaNode;
      readonly edits: NodeEdit[];
      readonly put: Put;
    };

/** A walk of a former Input onto an Endpoint's: recording its def sources, or, once named, building. */
export type Walk = {
  readonly defs: BothDefs;
  readonly resolve: BothResolvers;
  readonly met: GraftDefs;
  readonly out: Record<string, SchemaNode>;
  readonly frames: Frame[];
  grafts: boolean;
};

/** Where a pair's node goes, and the def whose body it sits in, if any. */
export type Place = { readonly owner: number | undefined; readonly put: Put };

/** Where the body of a def named apart goes: the former Input's defs, plain, as every def is; nowhere while recording. */
export function defPut(walk: Walk, name: string | undefined): Put {
  return (node) => {
    if (name !== undefined) {
      walk.out[name] = withoutNullable(node);
    }
  };
}

/** A `ref` renamed to the def the graft writes it to, nullable when a `ref` on the way to that def is. */
export function renamedRef(
  ref: SchemaNode,
  destination: { readonly name: string; readonly nullable: boolean },
): SchemaNode {
  return heldNodeOf(ref, [{ kind: 'renamed', ...destination }]);
}
