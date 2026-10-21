import type * as core from 'zod/v4/core';
import { leadsBackWithNoNode } from './children.ts';
import type { SchemaNode } from './nodes.ts';
import { notAllowed, refused, refusedDuplicateId } from './not-allowed.ts';
import { type LocatedSchema, type Walked, walked } from './walked.ts';

/** A schema the walk enters, where it sits and the id its own metadata gives it. */
export type Entering = LocatedSchema & { readonly id: string | undefined };

/**
 * The cycles of one walk: every schema with an id in a strongly connected group of schemas
 * that holds a cycle is written once under `defs` and is a `ref` wherever it is used,
 * whichever schema the walk enters the group at.
 */
export type Recursion = {
  readonly within: (entering: Entering, walk: () => Walked) => Walked;
  readonly defs: () => Readonly<Record<string, SchemaNode>>;
};

/** A schema being walked, numbered in walk order, with the lowest number it reaches back to. */
type Ancestor = Entering & { readonly index: number; low: number; reached: boolean };

/** A def written while the group it belongs to is still being walked. */
type OpenDef = { readonly schema: core.$ZodType; readonly index: number; readonly low: number };

type State = {
  readonly ancestors: Ancestor[];
  readonly openDefs: OpenDef[];
  readonly nameBySchema: Map<core.$ZodType, string>;
  readonly schemaById: Map<string, core.$ZodType>;
  readonly defById: Map<string, SchemaNode>;
  readonly reportedBySchema: Map<core.$ZodType, Walked>;
  count: number;
};

/** The recursion state shared by every schema of one Snapshot, so ids are unique across it. */
export function startRecursion(): Recursion {
  const state: State = {
    ancestors: [],
    openDefs: [],
    nameBySchema: new Map(),
    schemaById: new Map(),
    defById: new Map(),
    reportedBySchema: new Map(),
    count: 0,
  };
  return {
    within: (entering, walk) => within(state, entering, walk),
    defs: () => Object.fromEntries(state.defById),
  };
}

function within(state: State, entering: Entering, walk: () => Walked): Walked {
  const known = refOf(state, entering) ?? reportedOf(state, entering) ?? metAgain(state, entering);
  if (known !== undefined) {
    return known;
  }
  const index = state.count++;
  const ancestor: Ancestor = { ...entering, index, low: index, reached: false };
  state.ancestors.push(ancestor);
  const node = walk();
  state.ancestors.pop();
  reachBack(state, ancestor.low);
  const isOnCycle = ancestor.reached || ancestor.low < ancestor.index;
  const result = isOnCycle ? writeDef(state, ancestor, node) : node;
  closeGroup(state, ancestor);
  return result;
}

/** The `ref` of a schema already written, which joins its group when that is still open. */
function refOf(state: State, entering: Entering): Walked | undefined {
  const name = state.nameBySchema.get(entering.schema);
  if (name === undefined) {
    return undefined;
  }
  const open = state.openDefs.find((def) => def.schema === entering.schema);
  if (open !== undefined) {
    reachBack(state, open.low);
  }
  return walked({ type: 'ref', name });
}

/** The very failure already reported for a cycle the schema lies on. */
function reportedOf(state: State, entering: Entering): Walked | undefined {
  return state.reportedBySchema.get(entering.schema);
}

/**
 * The schema met again inside itself: its `ref` if it has an id, a failure if no schema of the
 * cycle has one, else nothing, so the walk goes through it again up to one that has.
 */
function metAgain(state: State, entering: Entering): Walked | undefined {
  const closingIndex = state.ancestors.findLastIndex(
    (ancestor) => ancestor.schema === entering.schema,
  );
  const closing = state.ancestors[closingIndex];
  if (closing === undefined) {
    return undefined;
  }
  closing.reached = true;
  reachBack(state, closing.index);
  const cycle = state.ancestors.slice(closingIndex);
  if (entering.id !== undefined) {
    return walked({ type: 'ref', name: entering.id });
  }
  if (cycle.some(hasId)) {
    return undefined;
  }
  const failure = notAllowed(entering.at, refused.unnamedCycle);
  for (const ancestor of cycle) {
    state.reportedBySchema.set(ancestor.schema, failure);
  }
  return failure;
}

/** The schema being walked now reaches back to the one numbered `low`, or lower. */
function reachBack(state: State, low: number): void {
  const current = state.ancestors.at(-1);
  if (current !== undefined) {
    current.low = Math.min(current.low, low);
  }
}

/** A schema that reaches back to nothing above it closes its group: no def of it stays open. */
function closeGroup(state: State, ancestor: Ancestor): void {
  if (ancestor.low !== ancestor.index) {
    return;
  }
  const remaining = state.openDefs.filter((def) => def.index < ancestor.index);
  state.openDefs.splice(0, state.openDefs.length, ...remaining);
}

/** A schema with an id on a cycle is walked once: its def, or its failures, kept for every use. */
function writeDef(state: State, ancestor: Ancestor, node: Walked): Walked {
  if (ancestor.id === undefined) {
    return node;
  }
  if (node.kind === 'not-allowed') {
    return dropOpenGroup(state, ancestor, node);
  }
  const owner = state.schemaById.get(ancestor.id);
  if (owner !== undefined && owner !== ancestor.schema) {
    return notAllowed(ancestor.at, refusedDuplicateId(ancestor.id));
  }
  state.schemaById.set(ancestor.id, ancestor.schema);
  if (leadsBackWithNoNode(ancestor.id, node.value, state.defById)) {
    return dropOpenGroup(state, ancestor, notAllowed(ancestor.at, refused.nodelessCycle));
  }
  state.nameBySchema.set(ancestor.schema, ancestor.id);
  state.defById.set(ancestor.id, node.value);
  state.openDefs.push({ schema: ancestor.schema, index: ancestor.index, low: ancestor.low });
  return walked({ type: 'ref', name: ancestor.id });
}

/**
 * Records the one failure of a def and drops the defs still open below it, which hold `ref`s to
 * it, so every use of any of them reports that failure. A dropped def leaves the open defs, so a
 * later failure higher up does not record itself over the first.
 */
function dropOpenGroup(state: State, ancestor: Ancestor, failure: Walked): Walked {
  state.reportedBySchema.set(ancestor.schema, failure);
  const dropped = state.openDefs.filter((def) => def.index > ancestor.index);
  for (const { schema } of dropped) {
    const name = state.nameBySchema.get(schema);
    if (name !== undefined) {
      state.defById.delete(name);
    }
    state.nameBySchema.delete(schema);
    state.reportedBySchema.set(schema, failure);
  }
  const remaining = state.openDefs.filter((def) => def.index <= ancestor.index);
  state.openDefs.splice(0, state.openDefs.length, ...remaining);
  return failure;
}

function hasId(ancestor: Ancestor): boolean {
  return ancestor.id !== undefined;
}
