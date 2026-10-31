import type { Defs, ObjectNode, SchemaNode, TupleNode } from '../src/internal/index.ts';

/** One way down from a node to a child, the child's place in its parent, and whether the graft enters it. */
export type Edge = {
  readonly child: SchemaNode;
  readonly path: readonly (string | number)[];
  readonly isEntered: boolean;
  readonly label: string;
};

/** The entries of a record in code point order of their keys, so two records with the same keys list them alike. */
export function sortedEntries<Value>(
  record: Readonly<Record<string, Value>>,
): readonly (readonly [string, Value])[] {
  return Object.entries(record).sort(([left], [right]) => (left < right ? -1 : 1));
}

/** The steps the graft does not enter: it compares what they lead to as a whole. */
const unenteredLabels: ReadonlySet<string> = new Set(['index', 'option', 'item']);

function edgeTo(child: SchemaNode, path: readonly (string | number)[], label: string): Edge {
  return { child, path, isEntered: !unenteredLabels.has(label), label };
}

/** The children of a tuple: its items, which the graft does not enter, and its rest, which it does. */
function tupleEdgesOf(node: TupleNode): readonly Edge[] {
  const items = node.items.map((item, index) => edgeTo(item, ['items', index], 'index'));
  return node.rest === undefined ? items : [...items, edgeTo(node.rest, ['rest'], 'rest')];
}

/** The children of a node, a record's key and value, an object's fields and a tagged union's variants in code point order. */
export function edgesOf(node: SchemaNode): readonly Edge[] {
  switch (node.type) {
    case 'object':
      return sortedEntries(node.fields).map(([name, { schema }]) =>
        edgeTo(schema, ['fields', name, 'schema'], 'field'),
      );
    case 'array':
      return [edgeTo(node.items, ['items'], 'items')];
    case 'record':
      return [edgeTo(node.key, ['key'], 'key'), edgeTo(node.value, ['value'], 'value')];
    case 'tuple':
      return tupleEdgesOf(node);
    case 'union':
      return node.options.map((option, index) => edgeTo(option, ['options', index], 'option'));
    case 'allOf':
      return node.items.map((item, index) => edgeTo(item, ['items', index], 'item'));
    case 'tagged':
      return sortedEntries(node.variants).map(([value, variant]) =>
        edgeTo(variant, ['variants', value], 'variant'),
      );
    default:
      return [];
  }
}

/** The defs a node names, each with whether every step down to the `ref` is one the graft enters. */
function namedByEntering(node: SchemaNode): readonly { name: string; isEntered: boolean }[] {
  const named: { name: string; isEntered: boolean }[] = [];
  const pending = [{ node, isEntered: true }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.node.type === 'ref') {
      named.push({ name: next.node.name, isEntered: next.isEntered });
    }
    for (const edge of edgesOf(next.node)) {
      pending.push({ node: edge.child, isEntered: next.isEntered && edge.isEntered });
    }
  }
  return named;
}

/** The defs some path from the Input reaches through a step the graft does not enter. */
export function defsReachedUnenteredFrom(
  roots: readonly SchemaNode[],
  defs: Defs,
): ReadonlySet<string> {
  const tainted = new Set<string>();
  const seen = new Set<string>();
  const pending = roots.flatMap(namedByEntering).map((named) => ({ ...named }));
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const key = `${next.name} ${next.isEntered}`;
    if (seen.has(key) || !Object.hasOwn(defs, next.name)) {
      continue;
    }
    seen.add(key);
    if (!next.isEntered) {
      tainted.add(next.name);
    }
    for (const inner of namedByEntering(defs[next.name] as SchemaNode)) {
      pending.push({ name: inner.name, isEntered: next.isEntered && inner.isEntered });
    }
  }
  return tainted;
}

/** An object inside a def, with the steps down to it and the way to it in the def. */
export type Site = {
  readonly owner: string;
  readonly path: readonly (string | number)[];
  readonly steps: readonly string[];
  readonly object: ObjectNode;
};

/** The objects inside a def that only entered steps lead to, the def's own root among them. */
export function sitesIn(owner: string, root: SchemaNode): readonly Site[] {
  const sites: Site[] = [];
  const pending = [{ node: root, path: [] as readonly (string | number)[], steps: [] as string[] }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.node.type === 'object') {
      sites.push({ owner, path: next.path, steps: next.steps, object: next.node });
    }
    for (const edge of edgesOf(next.node).filter(({ isEntered }) => isEntered)) {
      const steps = [...next.steps, edge.label];
      pending.push({ node: edge.child, path: [...next.path, ...edge.path], steps });
    }
  }
  return sites;
}
