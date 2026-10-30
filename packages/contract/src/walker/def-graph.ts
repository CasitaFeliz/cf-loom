import { childrenOf, nodesWithin } from './children.ts';
import type { RefNode, SchemaNode } from './nodes.ts';
import type { Defs } from './walk.ts';

/**
 * Every node within the given nodes and within each def they reach through `ref`s, directly or
 * through other defs; a def is added once.
 */
export function nodesReachedFrom(nodes: readonly SchemaNode[], defs: Defs): readonly SchemaNode[] {
  const reached: SchemaNode[] = [];
  const entered = new Set<string>();
  const pending: Pending[] = nodes.map((node): Pending => ({ kind: 'node', node })).toReversed();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    switch (next.kind) {
      case 'node': {
        const within = nodesWithin(next.node).map((inner) => inner.node);
        for (const node of within) {
          reached.push(node);
        }
        for (const ref of within.filter(isRef).toReversed()) {
          pending.push({ kind: 'def', name: ref.name });
        }
        break;
      }
      case 'def': {
        const def = defs[next.name];
        if (def !== undefined && !entered.has(next.name)) {
          entered.add(next.name);
          pending.push({ kind: 'node', node: def });
        }
        break;
      }
    }
  }
  return reached;
}

/** A node whose nodes come before the defs they reach, or a def entered once. */
type Pending =
  | { readonly kind: 'node'; readonly node: SchemaNode }
  | { readonly kind: 'def'; readonly name: string };

/** The def a `ref` stands for through any alias defs, by name, nullable when a `ref` on the way is. */
export type ResolvedRef = {
  readonly name: string;
  readonly def: SchemaNode;
  readonly nullable: boolean;
};

/**
 * The def a `ref` stands for through any alias defs, so every reader follows aliases alike; none
 * when a name on the way has no def or the aliases come back to one already followed.
 */
export function resolvedRefOf(ref: RefNode, defs: Defs): ResolvedRef | undefined {
  const followed = new Set<string>();
  let nullable = false;
  for (let current = ref; ; ) {
    const def = defs[current.name];
    if (def === undefined || followed.has(current.name)) {
      return undefined;
    }
    followed.add(current.name);
    nullable ||= current.nullable === true;
    if (def.type !== 'ref') {
      return { name: current.name, def, nullable };
    }
    current = def;
  }
}

/**
 * The def names the nodes reference through `ref`s, directly or through the defs those name, each
 * once; a name with no def is included, so a caller can tell it apart.
 */
export function reachedDefsOf(nodes: readonly SchemaNode[], defs: Defs): readonly string[] {
  const refs = nodesReachedFrom(nodes, defs).filter(isRef);
  return [...new Set(refs.map(({ name }) => name))];
}

/** The defs the nodes reach through `ref`s, directly or through other defs, keyed and ordered as in `defs`. */
export function defsReachedOf(nodes: readonly SchemaNode[], defs: Defs): Defs {
  const reached = new Set(reachedDefsOf(nodes, defs));
  return Object.fromEntries(Object.entries(defs).filter(([name]) => reached.has(name)));
}

function isRef(node: SchemaNode): node is RefNode {
  return node.type === 'ref';
}

/** The def names a node's own `ref`s name, each once, inside the node alone, with no def entered. */
export function refsWrittenIn(node: SchemaNode): readonly string[] {
  const names = new Set<string>();
  const pending = [node];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.type === 'ref') {
      names.add(next.name);
    }
    for (const child of childrenOf(next)) {
      pending.push(child.node);
    }
  }
  return [...names];
}
