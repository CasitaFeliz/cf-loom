import { childrenOf } from './children.ts';
import type { SchemaNode } from './nodes.ts';
import type { Defs } from './walk.ts';

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

/**
 * Each def's facts together with those of every def it reaches through `ref`s, from the facts each
 * holds in its own nodes, a name some `ref` gives with no def included as a def of no node: each
 * fact is carried back along each `ref` once, so the time grows with the defs, their nodes and the
 * facts, never with how deep a def reaches.
 */
export function closureFactsOf<Fact>(
  defs: Defs,
  ownFactsOf: (name: string, def: SchemaNode | undefined) => Iterable<Fact>,
): ReadonlyMap<string, ReadonlySet<Fact>> {
  const referrers = referrersOf(defs);
  const names = new Set([...Object.keys(defs), ...referrers.keys()]);
  const facts = new Map([...names].map((name): [string, Set<Fact>] => [name, new Set()]));
  const own: [string, Fact][] = [];
  for (const name of names) {
    const def = Object.hasOwn(defs, name) ? defs[name] : undefined;
    for (const fact of ownFactsOf(name, def)) {
      own.push([name, fact]);
    }
  }
  carryBack(own, referrers, facts);
  return facts;
}

/** The defs whose nodes write a `ref` to each name. */
function referrersOf(defs: Defs): Map<string, string[]> {
  const referrers = new Map<string, string[]>();
  for (const [name, def] of Object.entries(defs)) {
    for (const target of refsWrittenIn(def)) {
      const held = referrers.get(target);
      if (held === undefined) {
        referrers.set(target, [name]);
      } else {
        held.push(name);
      }
    }
  }
  return referrers;
}

/** Adds each fact to the def that holds it and to every def that reaches that one, each pair once. */
function carryBack<Fact>(
  pending: [string, Fact][],
  referrers: ReadonlyMap<string, readonly string[]>,
  facts: ReadonlyMap<string, Set<Fact>>,
): void {
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [name, fact] = next;
    const held = facts.get(name);
    if (held !== undefined && !held.has(fact)) {
      held.add(fact);
      for (const referrer of referrers.get(name) ?? []) {
        pending.push([referrer, fact]);
      }
    }
  }
}
