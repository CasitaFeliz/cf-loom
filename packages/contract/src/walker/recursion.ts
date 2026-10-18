import type * as core from 'zod/v4/core';
import type { Path, SchemaNode } from './nodes.ts';
import { notAllowed, refused, refusedDuplicateId } from './not-allowed.ts';
import { type Walked, walked } from './walked.ts';

/** Whether the walk goes into a schema, or already has its `ref` (or the failure in its place). */
export type Entered = { readonly kind: 'entered' } | Walked;

/**
 * The cycles of one walk: every schema with an id on a cycle is written once under `defs` and
 * is a `ref` wherever it is used, whichever schema the walk enters the cycle at.
 */
export type Recursion = {
  readonly enter: (schema: core.$ZodType, id: string | undefined, at: Path) => Entered;
  readonly leave: (schema: core.$ZodType, result: Walked, at: Path) => Walked;
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

  function enter(schema: core.$ZodType, id: string | undefined, at: Path): Entered {
    const name = nameBySchema.get(schema);
    if (name !== undefined) {
      return walked({ type: 'ref', name });
    }
    const met = ancestors.findLastIndex((ancestor) => ancestor.schema === schema);
    if (met !== -1) {
      return cycleClosedAt(ancestors, met, at);
    }
    ancestors.push({ schema, id, onCycle: false });
    return { kind: 'entered' };
  }

  function leave(schema: core.$ZodType, result: Walked, at: Path): Walked {
    const ancestor = ancestors.pop();
    if (result.kind === 'not-allowed' || ancestor?.onCycle !== true || ancestor.id === undefined) {
      return result;
    }
    const owner = schemaById.get(ancestor.id);
    if (owner !== undefined && owner !== schema) {
      return notAllowed(at, refusedDuplicateId(ancestor.id));
    }
    schemaById.set(ancestor.id, schema);
    nameBySchema.set(schema, ancestor.id);
    defs[ancestor.id] = result.value;
    return walked({ type: 'ref', name: ancestor.id });
  }

  return { enter, leave, defs: () => defs };
}

/** The schema met again: its `ref` if it has an id, else walked again up to one that has. */
function cycleClosedAt(ancestors: Ancestor[], met: number, at: Path): Entered {
  const cycle = ancestors.slice(met);
  const named = cycle.filter(hasId);
  for (const ancestor of named) {
    ancestor.onCycle = true;
  }
  const [closing] = cycle;
  if (closing?.id !== undefined) {
    return walked({ type: 'ref', name: closing.id });
  }
  if (named.length === 0 || closing === undefined) {
    return notAllowed(at, refused.unnamedCycle);
  }
  ancestors.push({ schema: closing.schema, id: undefined, onCycle: false });
  return { kind: 'entered' };
}

function hasId(ancestor: Ancestor): boolean {
  return ancestor.id !== undefined;
}
