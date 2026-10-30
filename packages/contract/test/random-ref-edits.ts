import {
  type Draft,
  type DraftGraph,
  drawFrom,
  isRef,
  type Next,
  pickFrom,
} from './random-draft.ts';

/** A description moved from a def to a `ref` that names it. */
export function descriptionMoved(draft: DraftGraph, nodes: Draft[], next: Next): boolean {
  const refs = nodes.filter(isRef);
  const movable = Object.entries(draft.defs).filter(
    ([name, def]) => def.description !== undefined && refs.some((ref) => ref.name === name),
  );
  const [name, def] = pickFrom(movable, next) ?? [];
  if (name === undefined || def === undefined) {
    return false;
  }
  const use = drawFrom(
    refs.filter((ref) => ref.name === name),
    next,
  );
  use.description = def.description;
  delete def.description;
  return true;
}

/** The `ref`s of each def that no node stands between and the def, which may name only lower defs. */
function limitsOf(draft: DraftGraph): Map<Draft, number> {
  const limits = new Map<Draft, number>();
  for (const [index, def] of Object.values(draft.defs).entries()) {
    for (const ref of nodelessRefsIn(def)) {
      limits.set(ref, index);
    }
  }
  return limits;
}

function nodelessRefsIn(node: Draft): Draft[] {
  switch (node.type) {
    case 'ref':
      return [node];
    case 'union':
      return (node.options as Draft[]).flatMap(nodelessRefsIn);
    case 'allOf':
      return (node.items as Draft[]).flatMap(nodelessRefsIn);
    default:
      return [];
  }
}

/** A `ref` made to name another def, one a nodeless path from a def may name only if lower. */
export function retargeted(draft: DraftGraph, nodes: Draft[], next: Next): boolean {
  const limits = limitsOf(draft);
  const names = Object.keys(draft.defs);
  const targetsOf = (ref: Draft) =>
    names.slice(0, limits.get(ref) ?? names.length).filter((name) => name !== ref.name);
  const movable = nodes.filter(isRef).filter((ref) => targetsOf(ref).length > 0);
  const ref = pickFrom(movable, next);
  if (ref === undefined) {
    return false;
  }
  ref.name = drawFrom(targetsOf(ref), next);
  return true;
}

/** A `ref` made to name a def only the proposed copy holds. */
export function retargetedToAddedDef(draft: DraftGraph, nodes: Draft[], next: Next): boolean {
  const added = `d${Object.keys(draft.defs).length}`;
  const field = { required: true, schema: { type: 'string' } };
  draft.defs[added] = { type: 'object', fields: { a: field } };
  drawFrom(nodes.filter(isRef), next).name = added;
  return true;
}
