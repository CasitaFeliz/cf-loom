import { byCodePoint } from './canonical-json.ts';
import { childrenOf, nodesWithin } from './children.ts';
import type { RefNode, SchemaNode } from './nodes.ts';
import type { Defs } from './walk.ts';

/**
 * The graph of the `ref`s between one Defs' defs, which answers every question about them. A Defs
 * is never changed once built, so the graph a Defs gives answers for as long as that Defs lives.
 */
export type DefGraph = {
  /** The def a name stands for: none unless the Defs holds it as an own key, since a name an object inherits, such as `toString`, is no def. */
  readonly def: (name: string) => SchemaNode | undefined;
};

const graphs = new WeakMap<Defs, DefGraph>();

/** The Def graph of a Defs, the same one each time it is asked for that Defs, which is never changed once built. */
export function defGraphOf(defs: Defs): DefGraph {
  const known = graphs.get(defs);
  if (known !== undefined) {
    return known;
  }
  const built: DefGraph = { def: (name) => defNamed(defs, name) };
  graphs.set(defs, built);
  return built;
}

/** The def a name stands for in a defs value: none unless `defs` holds it as an own key. */
export function defNamed(defs: Defs, name: string): SchemaNode | undefined {
  return Object.hasOwn(defs, name) ? defs[name] : undefined;
}

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
        const def = defNamed(defs, next.name);
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

/** The def each `ref` stands for through any alias defs, each alias def followed once for as long as its holder keeps it. */
export type RefResolver = (ref: RefNode) => ResolvedRef | undefined;

/**
 * A reader of the def each `ref` stands for in `defs`, so every reader follows aliases alike: none
 * when a name on the way has no def or the aliases come back to one already followed, nullable
 * when a `ref` on the way is. Each alias def is followed once per reader; its caller builds one for
 * a defs value and keeps it while it asks.
 */
export function refResolverOf(defs: Defs): RefResolver {
  const known: KnownDestinations = new Map();
  return (ref) => {
    const destination = destinationOf(ref.name, defs, known);
    if (destination === undefined || ref.nullable !== true || destination.nullable) {
      return destination;
    }
    return { ...destination, nullable: true };
  };
}

/** What a reader has found of the defs it was asked about, by name: the def a name leads to, none when it leads to none. */
type KnownDestinations = Map<string, ResolvedRef | undefined>;

/** The def a name leads to through alias defs, found by following them from the name to a def known or not an alias. */
function destinationOf(
  name: string,
  defs: Defs,
  known: KnownDestinations,
): ResolvedRef | undefined {
  const aliases: string[] = [];
  let destination = followedFrom(name, { defs, known }, aliases);
  for (let alias = aliases.pop(); alias !== undefined; alias = aliases.pop()) {
    const def = defNamed(defs, alias);
    if (destination !== undefined && def?.type === 'ref' && def.nullable === true) {
      destination = { ...destination, nullable: true };
    }
    known.set(alias, destination);
  }
  return destination;
}

/** The alias defs from a name on, pushed on `aliases`, and the def at their end: none at a name with no def or a name already followed. */
function followedFrom(
  name: string,
  reader: { readonly defs: Defs; readonly known: KnownDestinations },
  aliases: string[],
): ResolvedRef | undefined {
  const onPath = new Set<string>();
  for (let current = name; ; ) {
    if (reader.known.has(current)) {
      return reader.known.get(current);
    }
    const def = defNamed(reader.defs, current);
    if (def === undefined || onPath.has(current)) {
      return undefined;
    }
    if (def.type !== 'ref') {
      const destination = { name: current, def, nullable: false };
      reader.known.set(current, destination);
      return destination;
    }
    aliases.push(current);
    onPath.add(current);
    current = def.name;
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

/**
 * The defs the nodes reach through `ref`s, directly or through other defs, keyed in code point
 * order, as the canonical Snapshot keys them, in time that grows with what they reach.
 */
export function defsReachedOf(nodes: readonly SchemaNode[], defs: Defs): Defs {
  const held = reachedDefsOf(nodes, defs).filter((name) => defNamed(defs, name) !== undefined);
  held.sort(byCodePoint);
  return Object.fromEntries(held.map((name) => [name, defNamed(defs, name) as SchemaNode]));
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
