import type * as core from 'zod/v4/core';
import type { Path, SchemaNode, Walked } from './nodes.ts';
import { notAllowed, refused, refusedDuplicateId, walked } from './not-allowed.ts';

/** Whether the walk goes into a schema, or already has its `ref` (or the failure in its place). */
export type Entered = { readonly kind: 'entered' } | Walked;

/**
 * The cycles of one walk: a schema met again inside itself closes a cycle, is written once
 * under `defs` by its own id and is a `ref` wherever it is used.
 */
export type Recursion = {
  readonly enter: (schema: core.$ZodType, id: string | undefined, at: Path) => Entered;
  readonly leave: (schema: core.$ZodType, result: Walked, at: Path) => Walked;
  readonly defs: () => Readonly<Record<string, SchemaNode>>;
};

type Ancestor = { readonly id: string | undefined; closed: boolean };

/** The recursion state shared by every schema of one Snapshot, so ids are unique across it. */
export function startRecursion(): Recursion {
  const ancestors = new Map<core.$ZodType, Ancestor>();
  const nameBySchema = new Map<core.$ZodType, string>();
  const schemaById = new Map<string, core.$ZodType>();
  const defs: Record<string, SchemaNode> = {};

  function enter(schema: core.$ZodType, id: string | undefined, at: Path): Entered {
    const name = nameBySchema.get(schema);
    if (name !== undefined) {
      return walked({ type: 'ref', name });
    }
    const ancestor = ancestors.get(schema);
    if (ancestor !== undefined) {
      return closedBy(ancestor, at);
    }
    ancestors.set(schema, { id, closed: false });
    return { kind: 'entered' };
  }

  function leave(schema: core.$ZodType, result: Walked, at: Path): Walked {
    const ancestor = ancestors.get(schema);
    ancestors.delete(schema);
    if (result.kind === 'not-allowed' || ancestor?.closed !== true || ancestor.id === undefined) {
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

function closedBy(ancestor: Ancestor, at: Path): Walked {
  ancestor.closed = true;
  if (ancestor.id === undefined) {
    return notAllowed(at, refused.unnamedCycle);
  }
  return walked({ type: 'ref', name: ancestor.id });
}
