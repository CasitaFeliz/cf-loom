import { unbrokenLineOf } from '../lines/index.ts';
import {
  chainDown,
  type Defs,
  defGraphOf,
  type ResolvedRef,
  refNameOf,
  type SchemaNode,
  type Step,
  type StepChain,
} from '../walker/index.ts';
import { isUnchangedRefPair } from './def-comparison.ts';
import type { BothDefs, Finding, NodePair } from './findings.ts';
import { findingsOf } from './pair-findings.ts';

/**
 * A walk of the pairs of Baseline and proposed nodes over the two sides' defs: each pair one hop on
 * from a pair holding a `ref` is entered once for the walk, by its two nodes, whatever root or path
 * reaches it first, so the walk's time and memory grow with the pairs it enters and the findings
 * they hold, never with the paths that reach a pair.
 */
export type PairWalk = {
  /**
   * The pairs met from a root pair, the root's site at `at`, depth first with an explicit stack, and
   * each `found` finding in the order it is found: each pair's own findings, a pair inside it right
   * after the finding that names it, and the pair one hop on from a `ref` last. A root shares the
   * walk's memo with every root asked for before it.
   */
  readonly pairsFrom: (root: NodePair, at: readonly Step[]) => readonly Walked[];
};

/** What a walk gives, in order: a pair it meets, or a difference found at a place in the pair it is reading. */
export type Walked =
  | { readonly kind: 'met'; readonly met: MetPair }
  | {
      readonly kind: 'found';
      readonly in: MetPair;
      readonly finding: Extract<Finding, { kind: 'found' }>;
    };

/** A pair the walk meets, where it sits, and, when a side is a `ref`, what one hop on leads to. */
export type MetPair = {
  readonly pair: NodePair;
  readonly reached: Reached;
  /** Its steps from the root's site, or, inside a def the proposed side's `ref` names, from that def. */
  readonly steps: StepChain;
  /** The def its steps start from: none at the root's site. */
  readonly def: string | undefined;
  readonly hop: Hop | undefined;
};

/**
 * How the walk reached a pair: a root, a pair inside another at the steps of the finding that names
 * it (a use, whose nullability is compared), or one hop on from a pair holding a `ref` (whose is not:
 * a def is never nullable, and each `ref` carries its use's).
 */
export type Reached =
  | { readonly kind: 'root' }
  | { readonly kind: 'inside'; readonly by: MetPair; readonly steps: readonly Step[] }
  | { readonly kind: 'hop'; readonly by: MetPair };

/**
 * What a pair holding a `ref` leads to one hop on, each `ref` side becoming the def it names,
 * itself a `ref` when that is an alias def, with the def each side's `ref` stands for through its
 * alias defs: entered here and followed next; entered by an earlier pair, `first`, and not
 * followed; or, for two `ref`s naming one def the def comparison finds nothing differing in, never
 * followed.
 */
export type Hop = { readonly resolved: BothResolved } & (
  | { readonly kind: 'first' }
  | { readonly kind: 'again'; readonly first: MetPair }
  | { readonly kind: 'unchanged' }
);

/** The def each side's `ref` stands for through its alias defs, as its Def graph resolves it; none for a side written inline. */
export type BothResolved = {
  readonly baseline: ResolvedRef | undefined;
  readonly proposed: ResolvedRef | undefined;
};

/** Opens a walk of pairs over the Baseline's defs and the proposed ones. */
export function pairWalkOf(defs: BothDefs): PairWalk {
  const entered: Entered = new Map();
  return {
    pairsFrom: (root, at) =>
      walkedFrom(
        { pair: root, reached: { kind: 'root' }, steps: chainDown(undefined, at), def: undefined },
        { defs, entered },
      ),
  };
}

/** The pairs one hop on that a walk entered, by their nodes, each with the pair holding the `ref` that entered it. */
type Entered = Map<SchemaNode, Map<SchemaNode, MetPair>>;

type Walking = { readonly defs: BothDefs; readonly entered: Entered };

/** Where a pair sits, before it is read. */
type Placed = Pick<MetPair, 'pair' | 'reached' | 'steps' | 'def'>;

/** A pair being read: its findings, then the pair one hop on, if it enters one. */
type Level = {
  readonly met: MetPair;
  readonly findings: Iterator<Finding>;
  readonly onward: NodePair | undefined;
};

function walkedFrom(root: Placed, walking: Walking): readonly Walked[] {
  const walked: Walked[] = [];
  const levels: Level[] = [];
  const open = (placed: Placed) => {
    const level = levelOf(placed, walking);
    walked.push({ kind: 'met', met: level.met });
    levels.push(level);
  };
  open(root);
  for (let level = levels.at(-1); level !== undefined; level = levels.at(-1)) {
    const next = level.findings.next();
    if (next.done === true) {
      levels.pop();
      if (level.onward !== undefined) {
        open(hopPlacedFrom(level.met, level.onward));
      }
    } else if (next.value.kind === 'found') {
      walked.push({ kind: 'found', in: level.met, finding: next.value });
    } else {
      open(insidePlacedIn(level.met, next.value));
    }
  }
  return walked;
}

function insidePlacedIn(met: MetPair, finding: Extract<Finding, { kind: 'inside' }>): Placed {
  return {
    pair: finding.pair,
    reached: { kind: 'inside', by: met, steps: finding.steps },
    steps: chainDown(met.steps, finding.steps),
    def: met.def,
  };
}

/** The place a hop's pair is compared in: inside the def the proposed side names, from that def, else where the pair holding the `ref` is. */
function hopPlacedFrom(met: MetPair, onward: NodePair): Placed {
  const def = refNameOf(met.pair.proposed);
  const reached = { kind: 'hop', by: met } as const;
  return def === undefined
    ? { pair: onward, reached, steps: met.steps, def: met.def }
    : { pair: onward, reached, steps: undefined, def };
}

function levelOf(placed: Placed, { defs, entered }: Walking): Level {
  const { met, onward } = metPairOf(placed, defs, entered);
  const kind = met.reached.kind === 'hop' ? 'hop' : 'use';
  return { met, findings: findingsOf(met.pair, defs, kind).values(), onward };
}

/** A pair read, and the pair one hop on that it enters, if any. */
type Opened = { readonly met: MetPair; readonly onward: NodePair | undefined };

/**
 * A pair read, with what one hop on leads to when a side is a `ref`: the pair one hop on, unless
 * it was entered already or both sides name one def nothing differs in.
 */
function metPairOf(placed: Placed, defs: BothDefs, entered: Entered): Opened {
  const { pair } = placed;
  if (pair.baseline.type !== 'ref' && pair.proposed.type !== 'ref') {
    return { met: { ...placed, hop: undefined }, onward: undefined };
  }
  const onward = hopPairOf(pair, defs);
  const resolved = resolvedOf(pair, defs);
  if (isUnchangedRefPair(pair, defs)) {
    return { met: { ...placed, hop: { kind: 'unchanged', resolved } }, onward: undefined };
  }
  const first = entered.get(onward.baseline)?.get(onward.proposed);
  if (first !== undefined) {
    return { met: { ...placed, hop: { kind: 'again', resolved, first } }, onward: undefined };
  }
  const met: MetPair = { ...placed, hop: { kind: 'first', resolved } };
  const byProposed = entered.get(onward.baseline) ?? new Map<SchemaNode, MetPair>();
  entered.set(onward.baseline, byProposed.set(onward.proposed, met));
  return { met, onward };
}

/**
 * A pair holding a `ref`, one hop on: each `ref` becomes the def it names in its Snapshot's defs,
 * itself a `ref` when that def is an alias def, and a side written inline stays.
 */
function hopPairOf(pair: NodePair, defs: BothDefs): NodePair {
  return {
    baseline: defOf(pair.baseline, defs.baseline),
    proposed: defOf(pair.proposed, defs.proposed),
  };
}

/** The def a `ref` names, or the node itself when it is written inline: a name with no def is a bug. */
function defOf(node: SchemaNode, defs: Defs): SchemaNode {
  if (node.type !== 'ref') {
    return node;
  }
  const def = defGraphOf(defs).def(node.name);
  if (def === undefined) {
    throw new Error(unbrokenLineOf(`\`ref\` to ${node.name} reaches no schema: a bug.`));
  }
  return def;
}

function resolvedOf({ baseline, proposed }: NodePair, defs: BothDefs): BothResolved {
  return {
    baseline: baseline.type === 'ref' ? defGraphOf(defs.baseline).resolved(baseline) : undefined,
    proposed: proposed.type === 'ref' ? defGraphOf(defs.proposed).resolved(proposed) : undefined,
  };
}
