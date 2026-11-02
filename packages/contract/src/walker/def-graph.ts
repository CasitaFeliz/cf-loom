import { byCodePoint } from './canonical-json.ts';
import { refsWrittenIn } from './children.ts';
import { closureFactsFrom, type Referrers, referrersOf } from './closure-facts.ts';
import type { RefNode, SchemaNode } from './nodes.ts';
import type { Defs } from './walk.ts';

/**
 * The graph of the `ref`s between one Defs' defs, which answers every question about them. A Defs
 * is never changed once built, so the graph a Defs gives answers for as long as that Defs lives.
 */
export type DefGraph = {
  /** The def a name stands for: none unless the Defs holds it as an own key, since a name an object inherits, such as `toString`, is no def. */
  readonly def: (name: string) => SchemaNode | undefined;
  /**
   * The def a `ref` stands for through any alias defs, nullable when the `ref` or an alias def on the
   * way is; none when a name on the way has no def or the aliases come back to one already followed.
   * Each alias def is followed once for the graph.
   */
  readonly resolved: (ref: RefNode) => ResolvedRef | undefined;
  /** The defs the nodes reach through `ref`s, directly or through other defs, each read once. */
  readonly reached: (nodes: readonly SchemaNode[]) => ReachedDefs;
  /**
   * Each def's facts together with those of every def it reaches, from the facts each holds in its
   * own nodes, a name some `ref` gives with no def included as a def of no node: each fact is
   * carried back along each `ref` once, so the time grows with the defs, their nodes and the facts,
   * never with how deep a def reaches.
   */
  readonly closureFacts: <Fact>(
    ownFactsOf: (name: string, def: SchemaNode | undefined) => Iterable<Fact>,
  ) => ReadonlyMap<string, ReadonlySet<Fact>>;
};

/**
 * What some nodes reach: the defs the Defs holds, keyed in code point order as the canonical
 * Snapshot keys them, and apart, each once in the order first reached, the names a `ref` gives that
 * it does not hold.
 */
export type ReachedDefs = { readonly held: Defs; readonly unheld: readonly string[] };

/** The def a `ref` stands for through any alias defs, by name, nullable when a `ref` on the way is. */
export type ResolvedRef = {
  readonly name: string;
  readonly def: SchemaNode;
  readonly nullable: boolean;
};

const graphs = new WeakMap<Defs, DefGraph>();

/** The Def graph of a Defs, the same one each time it is asked for that Defs, which is never changed once built. */
export function defGraphOf(defs: Defs): DefGraph {
  const known = graphs.get(defs);
  if (known !== undefined) {
    return known;
  }
  const built = graphOf(defs);
  graphs.set(defs, built);
  return built;
}

function graphOf(defs: Defs): DefGraph {
  const known: KnownDestinations = new Map();
  let referrers: Referrers | undefined;
  const def = (name: string) => defNamed(defs, name);
  return {
    def,
    resolved: (ref) => resolvedFrom(ref, defs, known),
    reached: (nodes) => reachedFrom(nodes, def),
    closureFacts: (ownFactsOf) => {
      referrers ??= referrersOf(defs);
      return closureFactsFrom(referrers, def, ownFactsOf);
    },
  };
}

/** The defs the nodes' `ref`s name and those defs' `ref`s name in turn, each def read once, the names with no def apart. */
function reachedFrom(
  nodes: readonly SchemaNode[],
  def: (name: string) => SchemaNode | undefined,
): ReachedDefs {
  const held = new Map<string, SchemaNode>();
  const unheld: string[] = [];
  const entered = new Set<string>();
  const pending = nodes.toReversed();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const entering: SchemaNode[] = [];
    for (const name of refsWrittenIn(node).filter((written) => !entered.has(written))) {
      entered.add(name);
      const found = def(name);
      if (found === undefined) {
        unheld.push(name);
      } else {
        held.set(name, found);
        entering.push(found);
      }
    }
    for (const found of entering.toReversed()) {
      pending.push(found);
    }
  }
  const byName = [...held].sort(([left], [right]) => byCodePoint(left, right));
  return { held: Object.fromEntries(byName), unheld };
}

function defNamed(defs: Defs, name: string): SchemaNode | undefined {
  return Object.hasOwn(defs, name) ? defs[name] : undefined;
}

/** The def a `ref` stands for through alias defs, with the `ref`'s own nullability folded in. */
function resolvedFrom(ref: RefNode, defs: Defs, known: KnownDestinations): ResolvedRef | undefined {
  const destination = destinationOf(ref.name, defs, known);
  if (destination === undefined || ref.nullable !== true || destination.nullable) {
    return destination;
  }
  return { ...destination, nullable: true };
}

/** What the graph has found of the defs it was asked about, by name: the def a name leads to, none when it leads to none. */
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
  graph: { readonly defs: Defs; readonly known: KnownDestinations },
  aliases: string[],
): ResolvedRef | undefined {
  const onPath = new Set<string>();
  for (let current = name; ; ) {
    if (graph.known.has(current)) {
      return graph.known.get(current);
    }
    const def = defNamed(graph.defs, current);
    if (def === undefined || onPath.has(current)) {
      return undefined;
    }
    if (def.type !== 'ref') {
      const destination = { name: current, def, nullable: false };
      graph.known.set(current, destination);
      return destination;
    }
    aliases.push(current);
    onPath.add(current);
    current = def.name;
  }
}
