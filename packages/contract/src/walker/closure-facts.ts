import { refsWrittenIn } from './children.ts';
import type { SchemaNode } from './nodes.ts';
import type { Defs } from './walk.ts';

/** The defs whose nodes write a `ref` to each name, and every name a def or a `ref` gives. */
export type Referrers = {
  readonly namesGiven: ReadonlySet<string>;
  readonly referrersByName: ReadonlyMap<string, readonly string[]>;
};

/** The referrers of a Defs, found by reading each def's own nodes once. */
export function referrersOf(defs: Defs): Referrers {
  const namesGiven = new Set(Object.keys(defs));
  const referrersByName = new Map<string, string[]>();
  for (const [name, def] of Object.entries(defs)) {
    for (const target of refsWrittenIn(def)) {
      namesGiven.add(target);
      const held = referrersByName.get(target);
      if (held === undefined) {
        referrersByName.set(target, [name]);
      } else {
        held.push(name);
      }
    }
  }
  return { namesGiven, referrersByName };
}

/** The closure facts of the defs the referrers index, from the facts `ownFactsOf` gives each. */
export function closureFactsFrom<Fact>(
  referrers: Referrers,
  def: (name: string) => SchemaNode | undefined,
  ownFactsOf: (name: string, def: SchemaNode | undefined) => Iterable<Fact>,
): ReadonlyMap<string, ReadonlySet<Fact>> {
  const facts = new Map(
    [...referrers.namesGiven].map((name): [string, Set<Fact>] => [name, new Set()]),
  );
  const own: [string, Fact][] = [];
  for (const name of referrers.namesGiven) {
    for (const fact of ownFactsOf(name, def(name))) {
      own.push([name, fact]);
    }
  }
  carryBack(own, referrers.referrersByName, facts);
  return facts;
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
