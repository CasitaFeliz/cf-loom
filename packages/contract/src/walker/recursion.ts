import type * as core from 'zod/v4/core';
import type { Path, SchemaNode } from './nodes.ts';
import { notAllowed, refused, refusedDuplicateId } from './not-allowed.ts';
import { type LocatedSchema, type Walked, walked } from './walked.ts';

/**
 * The cycles of one walk: every schema with an id on a cycle is written once under `defs` and
 * is a `ref` wherever it is used, whichever schema the walk enters the cycle at.
 */
export type Recursion = {
  readonly within: (located: LocatedSchema, id: string | undefined, walk: () => Walked) => Walked;
  readonly defs: () => Readonly<Record<string, SchemaNode>>;
};

type Ancestor = {
  readonly schema: core.$ZodType;
  readonly id: string | undefined;
  onCycle: boolean;
};

/** The recursion state shared by every schema of one Snapshot, so ids are unique across it. */
export function startRecursion(): Recursion {
  const ancestors: Ancestor[] = [];
  const nameBySchema = new Map<core.$ZodType, string>();
  const schemaById = new Map<string, core.$ZodType>();
  const defs: Record<string, SchemaNode> = {};

  function within(located: LocatedSchema, id: string | undefined, walk: () => Walked): Walked {
    const { schema, at } = located;
    const name = nameBySchema.get(schema);
    if (name !== undefined) {
      return walked({ type: 'ref', name });
    }
    const closingIndex = ancestors.findLastIndex((ancestor) => ancestor.schema === schema);
    const closed = closingIndex === -1 ? undefined : closedCycle(ancestors.slice(closingIndex), at);
    if (closed !== undefined) {
      return closed;
    }
    const ancestor: Ancestor = { schema, id, onCycle: false };
    ancestors.push(ancestor);
    const node = walk();
    ancestors.pop();
    return ancestor.onCycle ? written(ancestor, node, at) : node;
  }

  function written(ancestor: Ancestor, node: Walked, at: Path): Walked {
    if (node.kind === 'not-allowed' || ancestor.id === undefined) {
      return node;
    }
    const owner = schemaById.get(ancestor.id);
    if (owner !== undefined && owner !== ancestor.schema) {
      return notAllowed(at, refusedDuplicateId(ancestor.id));
    }
    schemaById.set(ancestor.id, ancestor.schema);
    nameBySchema.set(ancestor.schema, ancestor.id);
    defs[ancestor.id] = node.value;
    return walked({ type: 'ref', name: ancestor.id });
  }

  return { within, defs: () => defs };
}

/**
 * The schema met again: its `ref` if it has an id, a failure if no schema of the cycle has
 * one, else nothing, so the walk goes through it again up to one that has.
 */
function closedCycle(cycle: readonly Ancestor[], at: Path): Walked | undefined {
  const named = cycle.filter(hasId);
  for (const ancestor of named) {
    ancestor.onCycle = true;
  }
  const [closing] = cycle;
  if (closing?.id !== undefined) {
    return walked({ type: 'ref', name: closing.id });
  }
  if (named.length === 0) {
    return notAllowed(at, refused.unnamedCycle);
  }
  return undefined;
}

function hasId(ancestor: Ancestor): boolean {
  return ancestor.id !== undefined;
}
