import type { Defs, SchemaNode } from '../src/internal/index.ts';
import {
  type Draft,
  type DraftGraph,
  drawFrom,
  inShapeOrder,
  keysOf,
  type Next,
  neutralNames,
  neutralValues,
  nodesIn,
  pickFrom,
  shapeTextOf,
} from './random-draft.ts';
import { descriptionMoved, retargeted, retargetedToAddedDef } from './random-ref-edits.ts';

/** What one edit of the proposed copy does to a Baseline def graph. */
export type Edit =
  | 'annotation'
  | 'moved description'
  | 'retarget'
  | 'retarget to an added def'
  | 'type'
  | 'required'
  | 'bound'
  | 'nullable';

/** Every edit, in the order a draw tries them from a seeded start, the first that applies landing. */
export const edits: readonly Edit[] = [
  'annotation',
  'moved description',
  'retarget',
  'retarget to an added def',
  'type',
  'required',
  'bound',
  'nullable',
];

/** The defs of a graph and its exports by name. */
export type Graph = { readonly defs: Defs; readonly exports: Readonly<Record<string, SchemaNode>> };

const retypedAs: Readonly<Record<string, string>> = {
  string: 'boolean',
  boolean: 'number',
  number: 'string',
  json: 'string',
};

/** The graph with one edit, the first of the edits from a seeded start that applies to it. */
export function editedCopy(graph: Graph, next: Next): { copy: Graph; edit: Edit } {
  const draft = structuredClone(graph) as unknown as DraftGraph;
  const start = Math.floor(next() * edits.length);
  for (let step = 0; step < edits.length; step++) {
    const edit = edits[(start + step) % edits.length] as Edit;
    if (applied(edit, draft, next)) {
      for (const node of nodesIn(draft).filter((inner) => inner.type === 'allOf')) {
        node.items = inShapeOrder(node.items as unknown[]);
      }
      return { copy: draft as unknown as Graph, edit };
    }
  }
  throw new Error('An annotation can always be edited: a bug.');
}

function applied(edit: Edit, draft: DraftGraph, next: Next): boolean {
  const nodes = nodesIn(draft);
  switch (edit) {
    case 'annotation':
      return annotationEdited(drawFrom(nodes, next), next);
    case 'moved description':
      return descriptionMoved(draft, nodes, next);
    case 'retarget':
      return retargeted(draft, nodes, next);
    case 'retarget to an added def':
      return retargetedToAddedDef(draft, nodes, next);
    case 'type':
      return retyped(nodes, next);
    case 'required':
      return requirednessFlipped(nodes, next);
    case 'bound':
      return boundChanged(nodes, next);
    case 'nullable':
      return nullabilityToggled(draft, nodes, next);
  }
}

function annotationEdited(node: Draft, next: Next): boolean {
  const name = drawFrom(neutralNames, next);
  const others = neutralValues[name].filter(
    (value) => shapeTextOf(value) !== shapeTextOf(node[name]),
  );
  if (node[name] !== undefined && next() < 0.5) {
    delete node[name];
  } else {
    node[name] = drawFrom(others, next);
  }
  return true;
}

function retyped(nodes: Draft[], next: Next): boolean {
  const keys = keysOf(nodes);
  const leaves = nodes.filter(
    (node) => Object.hasOwn(retypedAs, String(node.type)) && !keys.has(node),
  );
  const node = pickFrom(leaves, next);
  if (node === undefined) {
    return false;
  }
  const kept = Object.entries(node).filter(([key]) => key in neutralValues || key === 'nullable');
  const type = retypedAs[String(node.type)];
  for (const key of Object.keys(node)) {
    delete node[key];
  }
  Object.assign(node, Object.fromEntries(kept), { type });
  return true;
}

function requirednessFlipped(nodes: Draft[], next: Next): boolean {
  const objects = nodes.filter((node) => node.type === 'object');
  const fields = objects.flatMap((node) =>
    Object.entries(node.fields as Record<string, Draft>)
      .filter(([name]) => name !== 'kind')
      .map(([, field]) => field),
  );
  const field = pickFrom(fields, next);
  if (field === undefined) {
    return false;
  }
  field.required = field.required !== true;
  return true;
}

function boundChanged(nodes: Draft[], next: Next): boolean {
  const number = pickFrom(
    nodes.filter((node) => node.type === 'number'),
    next,
  );
  if (number === undefined) {
    return false;
  }
  number.min = (typeof number.min === 'number' ? number.min : 0) + 1;
  return true;
}

function nullabilityToggled(draft: DraftGraph, nodes: Draft[], next: Next): boolean {
  const exempt = new Set([...keysOf(nodes), ...Object.values(draft.defs)]);
  const node = pickFrom(
    nodes.filter((candidate) => candidate.type !== 'enum' && !exempt.has(candidate)),
    next,
  );
  if (node === undefined) {
    return false;
  }
  if (node.nullable === true) {
    delete node.nullable;
  } else {
    node.nullable = true;
  }
  return true;
}
