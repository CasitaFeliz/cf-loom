import { unbrokenLineOf } from '../lines/index.ts';
import type { Defs, RefNode, RefResolver, ResolvedRef, SchemaNode } from '../walker/index.ts';
import type { NodePair } from './findings.ts';

/** The readers of the aliases in a pair's two sides' defs, which the graft builds once for its walks. */
export type BothResolvers = { readonly baseline: RefResolver; readonly proposed: RefResolver };

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
export function followedPairOf(pair: NodePair, resolve: BothResolvers): FollowedPair {
  const baseline = resolvedSideOf(pair.baseline, resolve.baseline);
  const proposed = resolvedSideOf(pair.proposed, resolve.proposed);
  return {
    pair: { baseline: baseline.node, proposed: proposed.node },
    key: { baseline: baseline.key, proposed: proposed.key },
  };
}

/** One side of a pair as the graft follows it: the schema it stands for, and its key. */
type ResolvedSide = { readonly node: SchemaNode; readonly key: string | SchemaNode };

function resolvedSideOf(node: SchemaNode, resolve: RefResolver): ResolvedSide {
  if (node.type !== 'ref') {
    return { node, key: node };
  }
  const { name, def, nullable } = followedRefOf(node, resolve);
  return { node: nullable ? { ...def, nullable: true } : def, key: name };
}

/**
 * The def a `ref` stands for through alias defs, as the graft writes only destinations: a `ref`
 * that reaches none is a bug.
 */
export function followedRefOf(ref: RefNode, resolve: RefResolver): ResolvedRef {
  const resolved = resolve(ref);
  if (resolved === undefined) {
    throw new Error(unbrokenLineOf(`\`ref\` to ${ref.name} reaches no schema: a bug.`));
  }
  return resolved;
}

/**
 * A def a former Input's graft meets, in the order it meets them: a pair of a former node and a
 * proposed def, by its `PairKey`, with whether a field is grafted into its body and the pairs its
 * body reaches; or a def only the former Input reaches, copied as it was. `base` is the name of the
 * def it comes from.
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
 * for the second walk that builds them. Each source is found by its key in `pairIndex`, by the
 * two sides of its pair, or in `copyIndex`, by its name in the former Input.
 */
export type GraftDefs = {
  readonly sources: DefSource[];
  readonly names: readonly (string | undefined)[] | undefined;
  readonly met: Set<number>;
  readonly pairIndex: Map<string | SchemaNode, Map<string | SchemaNode, number>>;
  readonly copyIndex: Map<string, number>;
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
  return {
    sources: [],
    names: undefined,
    met: new Set(),
    pairIndex: new Map(),
    copyIndex: new Map(),
  };
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
  const nextSuffix = new Map<string, number>();
  const isTaken = (name: string) => Object.hasOwn(declared, name) || used.has(name);
  const names = recorded.sources.map((source, index) => {
    if (source.kind === 'pair' && !apart.has(index)) {
      return undefined;
    }
    const name = freeNameOf(source.base, { isTaken, nextSuffix });
    used.add(name);
    return name;
  });
  return { ...recorded, names, met: new Set() };
}

/** The pair a walk meets by its key, inside the body of the pair `owner` when it sits in one. */
export function pairMet(defs: GraftDefs, key: PairKey, owner: number | undefined): MetDef {
  const index = defs.pairIndex.get(key.baseline)?.get(key.proposed) ?? recordedPairOf(defs, key);
  recordedPairAt(defs, owner)?.reaches.push(index);
  const name = defs.names?.[index];
  const isBuilt = isFirstMet(defs, index) && (defs.names === undefined || name !== undefined);
  return { index, name, isBuilt };
}

/** The def a walk copies from the former Input, by its name there. */
export function copyMet(defs: GraftDefs, former: string): MetDef {
  const index = defs.copyIndex.get(former) ?? recordedCopyOf(defs, former);
  return { index, name: defs.names?.[index], isBuilt: isFirstMet(defs, index) };
}

/** Records a field grafted into the body of the pair `owner`, when it sits in one. */
export function graftRecorded(defs: GraftDefs, owner: number | undefined): void {
  const pair = recordedPairAt(defs, owner);
  if (pair !== undefined) {
    pair.grafts = true;
  }
}

/** Records a def the first walk meets, which the second walk meets again, never anew. */
function recordedSourceOf(defs: GraftDefs, source: DefSource): number {
  if (defs.names !== undefined) {
    throw new Error('A def the recording walk did not meet: a bug.');
  }
  defs.sources.push(source);
  return defs.sources.length - 1;
}

function recordedPairOf(defs: GraftDefs, key: PairKey): number {
  const source: DefSource = {
    kind: 'pair',
    key,
    base: String(key.proposed),
    grafts: false,
    reaches: [],
  };
  const index = recordedSourceOf(defs, source);
  const byProposed = defs.pairIndex.get(key.baseline) ?? new Map<string | SchemaNode, number>();
  byProposed.set(key.proposed, index);
  defs.pairIndex.set(key.baseline, byProposed);
  return index;
}

function recordedCopyOf(defs: GraftDefs, former: string): number {
  const index = recordedSourceOf(defs, { kind: 'copy', base: former });
  defs.copyIndex.set(former, index);
  return index;
}

function isFirstMet(defs: GraftDefs, index: number): boolean {
  const isFirst = !defs.met.has(index);
  defs.met.add(index);
  return isFirst;
}

/** The pair at `owner`, while recording; none once named, since the names are already decided. */
function recordedPairAt(defs: GraftDefs, owner: number | undefined) {
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
        const reaching = reachedBy.get(reached) ?? [];
        reaching.push(index);
        reachedBy.set(reached, reaching);
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

/** The name a def comes from if free, else that name with the first suffix free, `~1`, `~2`…; a base is never tried below the suffix it last took, which no later name frees. */
function freeNameOf(
  base: string,
  names: {
    readonly isTaken: (name: string) => boolean;
    readonly nextSuffix: Map<string, number>;
  },
): string {
  if (!names.isTaken(base)) {
    return base;
  }
  let suffix = names.nextSuffix.get(base) ?? 1;
  while (names.isTaken(`${base}~${suffix}`)) {
    suffix++;
  }
  names.nextSuffix.set(base, suffix + 1);
  return `${base}~${suffix}`;
}
