import type * as core from 'zod/v4/core';
import type { SchemaNode } from './nodes.ts';
import { notAllowed, refused, refusedDuplicateId } from './not-allowed.ts';
import { type LocatedSchema, type Walked, walked } from './walked.ts';

/** A schema the walk enters, where it sits and the id its own metadata gives it. */
export type Entering = LocatedSchema & { readonly id: string | undefined };

/**
 * The cycles of one walk: every schema with an id on a cycle is written once under `defs` and
 * is a `ref` wherever it is used, whichever schema the walk enters the cycle at.
 */
export type Recursion = {
  readonly within: (entering: Entering, walk: () => Walked) => Walked;
  readonly defs: () => Readonly<Record<string, SchemaNode>>;
};

type Ancestor = Entering & { onCycle: boolean };

type State = {
  readonly ancestors: Ancestor[];
  readonly nameBySchema: Map<core.$ZodType, string>;
  readonly schemaById: Map<string, core.$ZodType>;
  readonly defs: Record<string, SchemaNode>;
  readonly reported: Set<core.$ZodType>;
};

/** The recursion state shared by every schema of one Snapshot, so ids are unique across it. */
export function startRecursion(): Recursion {
  const state: State = {
    ancestors: [],
    nameBySchema: new Map(),
    schemaById: new Map(),
    defs: {},
    reported: new Set(),
  };
  return { within: (entering, walk) => within(state, entering, walk), defs: () => state.defs };
}

function within(state: State, entering: Entering, walk: () => Walked): Walked {
  const known = metBefore(state, entering);
  if (known !== undefined) {
    return known;
  }
  const ancestor: Ancestor = { ...entering, onCycle: false };
  state.ancestors.push(ancestor);
  const node = walk();
  state.ancestors.pop();
  return ancestor.onCycle ? written(state, ancestor, node) : node;
}

/**
 * What a schema the walk already knows gives: its `ref`, nothing again for one on a cycle
 * already reported, or what the cycle it closes gives.
 */
function metBefore(state: State, entering: Entering): Walked | undefined {
  const name = state.nameBySchema.get(entering.schema);
  if (name !== undefined) {
    return walked({ type: 'ref', name });
  }
  if (state.reported.has(entering.schema)) {
    return { kind: 'not-allowed', failures: [] };
  }
  const closingIndex = state.ancestors.findLastIndex(
    (ancestor) => ancestor.schema === entering.schema,
  );
  if (closingIndex === -1) {
    return undefined;
  }
  const cycle = state.ancestors.slice(closingIndex);
  const closed = closedCycle(cycle, entering);
  if (closed?.kind === 'not-allowed') {
    for (const ancestor of cycle) {
      state.reported.add(ancestor.schema);
    }
  }
  return closed;
}

/**
 * The schema met again: its `ref` if it has an id, a failure if no schema of the cycle has
 * one, else nothing, so the walk goes through it again up to one that has.
 */
function closedCycle(cycle: readonly Ancestor[], entering: Entering): Walked | undefined {
  const named = cycle.filter(hasId);
  for (const ancestor of named) {
    ancestor.onCycle = true;
  }
  if (entering.id !== undefined) {
    return walked({ type: 'ref', name: entering.id });
  }
  if (named.length === 0) {
    return notAllowed(entering.at, refused.unnamedCycle);
  }
  return undefined;
}

function written(state: State, ancestor: Ancestor, node: Walked): Walked {
  if (node.kind === 'not-allowed' || ancestor.id === undefined) {
    return node;
  }
  const owner = state.schemaById.get(ancestor.id);
  if (owner !== undefined && owner !== ancestor.schema) {
    return notAllowed(ancestor.at, refusedDuplicateId(ancestor.id));
  }
  state.schemaById.set(ancestor.id, ancestor.schema);
  state.nameBySchema.set(ancestor.schema, ancestor.id);
  state.defs[ancestor.id] = node.value;
  return walked({ type: 'ref', name: ancestor.id });
}

function hasId(ancestor: Ancestor): boolean {
  return ancestor.id !== undefined;
}
