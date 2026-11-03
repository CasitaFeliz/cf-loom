import {
  chainDown,
  type Defs,
  defGraphOf,
  type ResolvedRef,
  type SchemaNode,
  type Step,
  type StepChain,
} from '../walker/index.ts';
import { type AliasLink, aliasLinksOf, defOf, passesAlias } from './alias-runs.ts';
import { isUnchangedRefPair } from './def-comparison.ts';
import type { BothDefs, Finding, NodePair } from './findings.ts';
import { findingsOf } from './pair-findings.ts';

/**
 * A walk of the pairs of Baseline and proposed nodes over the two sides' defs: each pair a pair
 * holding a `ref` leads to, each `ref` side resolved through its alias defs to the def it stands
 * for, is entered once for the walk, by its two nodes, whatever root or path reaches it first, so
 * the walk's time and memory grow with the pairs it enters and the findings they hold, never with
 * the paths that reach a pair or the alias defs between a `ref` and its def.
 */
export type PairWalk = {
  /**
   * The pairs met from a root pair, the root's site at `at`, depth first with an explicit stack, and
   * each `found` finding in the order it is found: each pair's own findings, a pair inside it right
   * after the finding that names it, then, for a pair holding a `ref`, a `passed` item when a side
   * passes an alias def, and the pair the `ref`s resolve to last. A root shares the walk's memo with
   * every root asked for before it.
   */
  readonly pairsFrom: (root: NodePair, at: readonly Step[]) => readonly Walked[];
};

/** A difference found at a place in the pair the walk is reading. */
export type FoundAt = {
  readonly kind: 'found';
  readonly in: MetPair;
  readonly finding: Extract<Finding, { kind: 'found' }>;
};

/**
 * What a walk gives, in order: a pair it meets, a difference found in it, or, before the pair a
 * `ref` resolves to, the alias defs the hop passed over, whose own differences `read` gives: each
 * alias pair at the def and steps one hop at a time would place it, in that order, the alias pairs
 * this walk already gave left out, so a reader that reads every `passed` item as it comes gets each
 * once.
 */
export type Walked =
  | { readonly kind: 'met'; readonly met: MetPair }
  | FoundAt
  | { readonly kind: 'passed'; readonly read: () => readonly FoundAt[] };

/** A pair the walk meets, where it sits, and, when a side is a `ref`, what the hop leads to. */
export type MetPair = {
  readonly pair: NodePair;
  readonly reached: Reached;
  /** Its steps from the root's site, or, inside a def the proposed side's `ref` resolves to, from that def. */
  readonly steps: StepChain;
  /** The def its steps start from: none at the root's site. */
  readonly def: string | undefined;
  readonly hop: Hop | undefined;
};

/**
 * How the walk reached a pair: a root, a pair inside another at the steps of the finding that names
 * it (a use, whose nullability is compared), or by the hop from a pair holding a `ref` (whose is
 * not: a def is never nullable, and each `ref` carries its use's).
 */
export type Reached =
  | { readonly kind: 'root' }
  | { readonly kind: 'inside'; readonly by: MetPair; readonly steps: readonly Step[] }
  | { readonly kind: 'hop'; readonly by: MetPair };

/**
 * What a pair holding a `ref` leads to: each `ref` side the def it stands for through its alias
 * defs, as its Def graph resolves it, and a side written inline as it is: entered here and
 * followed next; entered before, as `entered`, and not followed; or, for two `ref`s naming one def
 * the def comparison finds nothing differing in, or resolving to one such def, never followed.
 */
export type Hop = { readonly resolved: BothResolved } & (
  | { readonly kind: 'first' }
  | { readonly kind: 'again'; readonly entered: MetPair }
  | { readonly kind: 'unchanged' }
);

/** The def each side's `ref` stands for through its alias defs, as its Def graph resolves it; none for a side written inline. */
export type BothResolved = {
  readonly baseline: ResolvedRef | undefined;
  readonly proposed: ResolvedRef | undefined;
};

/** Opens a walk of pairs over the Baseline's defs and the proposed ones. */
export function pairWalkOf(defs: BothDefs): PairWalk {
  const walking: Walking = { defs, entered: new Map(), given: new Set() };
  return {
    pairsFrom: (root, at) =>
      walkedFrom(
        { pair: root, reached: { kind: 'root' }, steps: chainDown(undefined, at), def: undefined },
        walking,
      ),
  };
}

type Walking = {
  readonly defs: BothDefs;
  /** The pairs a hop entered, by their nodes. */
  readonly entered: Map<SchemaNode, Map<SchemaNode, MetPair>>;
  /** The alias pairs with findings whose findings this walk gave. */
  readonly given: Set<AliasLink>;
};

/** Where a pair sits, before it is read. */
type Placed = Pick<MetPair, 'pair' | 'reached' | 'steps' | 'def'>;

/** A pair being read: its findings, then the alias defs its hop passes, then the pair the hop leads to. */
type Level = {
  readonly met: MetPair;
  readonly findings: Iterator<Finding>;
  readonly passes: boolean;
  readonly onward: NodePair | undefined;
};

function walkedFrom(root: Placed, walking: Walking): readonly Walked[] {
  const walked: Walked[] = [];
  const levels: Level[] = [];
  const open = (placed: Placed): MetPair => {
    const level = levelOf(placed, walking);
    walked.push({ kind: 'met', met: level.met });
    levels.push(level);
    return level.met;
  };
  open(root);
  for (let level = levels.at(-1); level !== undefined; level = levels.at(-1)) {
    const next = level.findings.next();
    if (next.done !== true) {
      if (next.value.kind === 'found') {
        walked.push({ kind: 'found', in: level.met, finding: next.value });
      } else {
        open(insidePlacedIn(level.met, next.value));
      }
      continue;
    }
    levels.pop();
    if (level.passes) {
      walked.push({ kind: 'passed', read: () => passedOver(level.met, walking) });
    }
    if (level.onward !== undefined) {
      enteredAs(walking, level.onward, open(hopPlacedFrom(level.met, level.onward)));
    }
  }
  return walked;
}

function enteredAs({ entered }: Walking, { baseline, proposed }: NodePair, met: MetPair): void {
  entered.set(
    baseline,
    (entered.get(baseline) ?? new Map<SchemaNode, MetPair>()).set(proposed, met),
  );
}

function insidePlacedIn(met: MetPair, finding: Extract<Finding, { kind: 'inside' }>): Placed {
  return {
    pair: finding.pair,
    reached: { kind: 'inside', by: met, steps: finding.steps },
    steps: chainDown(met.steps, finding.steps),
    def: met.def,
  };
}

/** The place the pair a hop leads to is compared in: inside the def the proposed side stands for, from that def, else where the pair holding the `ref` is. */
function hopPlacedFrom(met: MetPair, onward: NodePair): Placed {
  const def = met.hop?.resolved.proposed?.name;
  const reached = { kind: 'hop', by: met } as const;
  return def === undefined
    ? { pair: onward, reached, steps: met.steps, def: met.def }
    : { pair: onward, reached, steps: undefined, def };
}

function levelOf(placed: Placed, walking: Walking): Level {
  const { met, onward, passes } = metPairOf(placed, walking);
  const kind = met.reached.kind === 'hop' ? 'hop' : 'use';
  return { met, findings: findingsOf(met.pair, walking.defs, kind).values(), passes, onward };
}

/** The findings of the alias pairs a hop passes over, each where the walk one hop at a time met it, up to the first this walk gave. */
function passedOver(met: MetPair, { defs, given }: Walking): readonly FoundAt[] {
  const founds: FoundAt[] = [];
  let place = { steps: met.steps, def: met.def };
  for (let link = aliasLinksOf(met.pair, defs); link !== undefined; link = link.next) {
    if (given.has(link)) {
      break;
    }
    given.add(link);
    place = link.def === undefined ? place : { steps: undefined, def: link.def };
    const alias: MetPair = {
      pair: link.pair,
      reached: { kind: 'hop', by: met },
      ...place,
      hop: undefined,
    };
    for (const finding of link.findings) {
      founds.push({ kind: 'found', in: alias, finding });
    }
  }
  return founds;
}

/** A pair read, whether its hop passes an alias def, and the pair it leads to, if it is followed. */
type Opened = {
  readonly met: MetPair;
  readonly passes: boolean;
  readonly onward: NodePair | undefined;
};

/**
 * A pair read, with what the hop leads to when a side is a `ref`: the pair its `ref`s resolve to,
 * unless it was entered already or both sides stand for one def nothing differs in.
 */
function metPairOf(placed: Placed, { defs, entered }: Walking): Opened {
  const { pair } = placed;
  if (pair.baseline.type !== 'ref' && pair.proposed.type !== 'ref') {
    return { met: { ...placed, hop: undefined }, passes: false, onward: undefined };
  }
  const resolved = resolvedOf(pair, defs);
  const isSameRefs = isUnchangedRefPair(pair, defs);
  const passes = !isSameRefs && passesAlias(pair, defs);
  const onward = resolvedPairOf(pair, defs);
  if (isSameRefs || isUnchangedResolved(resolved, defs)) {
    return { met: { ...placed, hop: { kind: 'unchanged', resolved } }, passes, onward: undefined };
  }
  const known = entered.get(onward.baseline)?.get(onward.proposed);
  if (known !== undefined) {
    return {
      met: { ...placed, hop: { kind: 'again', resolved, entered: known } },
      passes,
      onward: undefined,
    };
  }
  return { met: { ...placed, hop: { kind: 'first', resolved } }, passes, onward };
}

function resolvedOf({ baseline, proposed }: NodePair, defs: BothDefs): BothResolved {
  return {
    baseline: baseline.type === 'ref' ? defGraphOf(defs.baseline).resolved(baseline) : undefined,
    proposed: proposed.type === 'ref' ? defGraphOf(defs.proposed).resolved(proposed) : undefined,
  };
}

/** Whether both sides stand for one def by name that, with every def it reaches, is the same on both sides. */
function isUnchangedResolved({ baseline, proposed }: BothResolved, defs: BothDefs): boolean {
  if (baseline === undefined || proposed === undefined || baseline.name !== proposed.name) {
    return false;
  }
  const ref = { type: 'ref', name: baseline.name } as const;
  return isUnchangedRefPair({ baseline: ref, proposed: ref }, defs);
}

/** The pair a pair holding a `ref` leads to: each `ref` side the def its Def graph resolves it to, a side written inline as it is. */
function resolvedPairOf(pair: NodePair, defs: BothDefs): NodePair {
  const side = (node: SchemaNode, held: Defs) =>
    node.type === 'ref' ? (defGraphOf(held).resolved(node)?.def ?? defOf(node, held)) : node;
  return {
    baseline: side(pair.baseline, defs.baseline),
    proposed: side(pair.proposed, defs.proposed),
  };
}
