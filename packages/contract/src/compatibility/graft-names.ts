import {
  type Defs,
  type RefNode,
  type ResolvedRef,
  resolvedRefOf,
  type SchemaNode,
} from '../walker/index.ts';
import type { BothDefs, NodePair } from './findings.ts';

/**
 * The key of a pair the graft follows: each side by the name of the def its `ref` stands for, or
 * by the node itself when written inline.
 */
export type PairKey = {
  readonly baseline: string | SchemaNode;
  readonly proposed: string | SchemaNode;
};

/** A pair as the graft follows it: each `ref` resolved to its def, and the key to meet the pair by. */
export type FollowedPair = { readonly pair: NodePair; readonly key: PairKey };

/**
 * A pair with each `ref` followed through alias defs to the def it stands for, nullable when the
 * `ref` is and keyed by its name, since the graft writes only destinations; a side written inline
 * stays and is its own key.
 */
export function followedPairOf(pair: NodePair, defs: BothDefs): FollowedPair {
  const baseline = resolvedSideOf(pair.baseline, defs.baseline);
  const proposed = resolvedSideOf(pair.proposed, defs.proposed);
  return {
    pair: { baseline: baseline.node, proposed: proposed.node },
    key: { baseline: baseline.key, proposed: proposed.key },
  };
}

/** One side of a pair as the graft follows it: the schema it stands for, and its key. */
type ResolvedSide = { readonly node: SchemaNode; readonly key: string | SchemaNode };

function resolvedSideOf(node: SchemaNode, defs: Defs): ResolvedSide {
  if (node.type !== 'ref') {
    return { node, key: node };
  }
  const { name, def, nullable } = followedRefOf(node, defs);
  return { node: nullable ? { ...def, nullable: true } : def, key: name };
}

/**
 * The def a `ref` stands for through alias defs, as the graft writes only destinations: a `ref`
 * that reaches none is a bug.
 */
export function followedRefOf(ref: RefNode, defs: Defs): ResolvedRef {
  const resolved = resolvedRefOf(ref, defs);
  if (resolved === undefined) {
    throw new Error(`\`ref\` to ${ref.name} reaches no schema: a bug.`);
  }
  return resolved;
}

/**
 * A def a former Input's graft meets, in the order it meets them: a pair of a former node and a
 * proposed def, by its `PairKey`, with whether a field is grafted into its body
 * and the pairs its body reaches; or a def only the former Input reaches, copied as it was. `base`
 * is the name of the def it comes from.
 */
type DefSource =
  | {
      readonly kind: 'pair';
      readonly key: PairKey;
      readonly base: string;
      grafts: boolean;
      readonly reaches: number[];
    }
  | { readonly kind: 'copy'; readonly base: string };

/**
 * The defs a graft meets: recorded on its first walk, while `names` is `undefined`, then named,
 * for the second walk that builds them.
 */
export type GraftDefs = {
  readonly sources: DefSource[];
  readonly names: readonly (string | undefined)[] | undefined;
  readonly met: Set<number>;
};

/**
 * A def the walk meets: where it sits among the sources, its name in the former Input, `undefined`
 * for a pair held as the Snapshot declares it or while recording, and whether the walk builds its
 * body now, the first time it meets one it records or names apart.
 */
export type MetDef = {
  readonly index: number;
  readonly name: string | undefined;
  readonly isBuilt: boolean;
};

/** The defs of a graft's first walk, which records them. */
export function recordingDefs(): GraftDefs {
  return { sources: [], names: undefined, met: new Set() };
}

/**
 * The defs a graft recorded, named: a pair that grafts no field and reaches no def named apart is
 * held as the Snapshot declares it; every other def takes the name of the def it comes from, or
 * that name with `~1`, `~2`…, the first the Snapshot's defs and the names before it leave free. A
 * recursion id never holds `~`, so none collides with a declared one.
 */
export function namedDefs(recorded: GraftDefs, declared: Defs): GraftDefs {
  const apart = namedApartOf(recorded.sources);
  const used = new Set<string>();
  const names = recorded.sources.map((source, index) => {
    if (source.kind === 'pair' && !apart.has(index)) {
      return undefined;
    }
    const isTaken = (name: string) => Object.hasOwn(declared, name) || used.has(name);
    const name = freeNameOf(source.base, isTaken);
    used.add(name);
    return name;
  });
  return { sources: recorded.sources, names, met: new Set() };
}

/** The pair a walk meets by its key, inside the body of the pair `owner` when it sits in one. */
export function pairMet(defs: GraftDefs, key: PairKey, owner: number | undefined): MetDef {
  const index = sourceIndexOf(defs, (source) => source.kind === 'pair' && isKey(source.key, key), {
    kind: 'pair',
    key,
    base: String(key.proposed),
    grafts: false,
    reaches: [],
  });
  recordedPairOf(defs, owner)?.reaches.push(index);
  const name = defs.names?.[index];
  const isBuilt = isFirstMet(defs, index) && (defs.names === undefined || name !== undefined);
  return { index, name, isBuilt };
}

/** The def a walk copies from the former Input, by its name there. */
export function copyMet(defs: GraftDefs, former: string): MetDef {
  const index = sourceIndexOf(defs, (source) => source.kind === 'copy' && source.base === former, {
    kind: 'copy',
    base: former,
  });
  return { index, name: defs.names?.[index], isBuilt: isFirstMet(defs, index) };
}

/** Records a field grafted into the body of the pair `owner`, when it sits in one. */
export function graftRecorded(defs: GraftDefs, owner: number | undefined): void {
  const pair = recordedPairOf(defs, owner);
  if (pair !== undefined) {
    pair.grafts = true;
  }
}

function sourceIndexOf(
  defs: GraftDefs,
  isIt: (source: DefSource) => boolean,
  recorded: DefSource,
): number {
  const found = defs.sources.findIndex(isIt);
  if (found !== -1) {
    return found;
  }
  if (defs.names !== undefined) {
    throw new Error('A def the recording walk did not meet: a bug.');
  }
  defs.sources.push(recorded);
  return defs.sources.length - 1;
}

function isFirstMet(defs: GraftDefs, index: number): boolean {
  const isFirst = !defs.met.has(index);
  defs.met.add(index);
  return isFirst;
}

function isKey(key: PairKey, other: PairKey): boolean {
  return key.baseline === other.baseline && key.proposed === other.proposed;
}

/** The pair at `owner`, while recording; none once named, since the names are already decided. */
function recordedPairOf(defs: GraftDefs, owner: number | undefined) {
  const source = owner === undefined || defs.names !== undefined ? undefined : defs.sources[owner];
  return source?.kind === 'pair' ? source : undefined;
}

/** The pairs named apart: those that graft a field, and every pair that reaches one of them. */
function namedApartOf(sources: readonly DefSource[]): ReadonlySet<number> {
  const reachedBy = new Map<number, number[]>();
  const pending: number[] = [];
  for (const [index, source] of sources.entries()) {
    if (source.kind === 'pair') {
      for (const reached of source.reaches) {
        reachedBy.set(reached, [...(reachedBy.get(reached) ?? []), index]);
      }
      if (source.grafts) {
        pending.push(index);
      }
    }
  }
  const apart = new Set(pending);
  for (let index = pending.pop(); index !== undefined; index = pending.pop()) {
    const reaching = (reachedBy.get(index) ?? []).filter((source) => !apart.has(source));
    for (const source of reaching) {
      apart.add(source);
      pending.push(source);
    }
  }
  return apart;
}

function freeNameOf(base: string, isTaken: (name: string) => boolean): string {
  if (!isTaken(base)) {
    return base;
  }
  let suffix = 1;
  while (isTaken(`${base}~${suffix}`)) {
    suffix++;
  }
  return `${base}~${suffix}`;
}
