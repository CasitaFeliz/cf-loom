import { type Defs, refNameOf, type SchemaNode } from '../walker/index.ts';
import { isUnchangedRefPair } from './def-comparison.ts';
import type { BothDefs, Finding, NodePair } from './findings.ts';
import { findingsOf } from './pair-findings.ts';
import { namedDefOf } from './ref-defs.ts';

/**
 * An alias pair with findings of its own on a run of hops, the def the walk one hop at a time
 * places it in (none: where the run starts), and the next such pair on the run.
 */
export type AliasLink = {
  readonly pair: NodePair;
  readonly def: string | undefined;
  readonly findings: readonly Extract<Finding, { kind: 'found' }>[];
  readonly next: AliasLink | undefined;
};

/** The alias pairs with findings on the hops from a pair, its own first when it has findings. */
type Run = { readonly links: AliasLink | undefined };

const runs = new WeakMap<Defs, WeakMap<Defs, Map<SchemaNode, Map<SchemaNode, Run>>>>();

function runsOf(defs: BothDefs): Map<SchemaNode, Map<SchemaNode, Run>> {
  const byProposed = runs.get(defs.baseline) ?? new WeakMap();
  runs.set(defs.baseline, byProposed);
  const memo = byProposed.get(defs.proposed) ?? new Map();
  byProposed.set(defs.proposed, memo);
  return memo;
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

function defOf(node: SchemaNode, defs: Defs): SchemaNode {
  return node.type === 'ref' ? namedDefOf(node, defs) : node;
}

/** Whether neither side of a pair is a `ref`. */
function holdsNoRef({ baseline, proposed }: NodePair): boolean {
  return baseline.type !== 'ref' && proposed.type !== 'ref';
}

const noLinks: Run = { links: undefined };

/**
 * The alias pairs on the hops from the first, up to the first kept for the two defs values or the
 * one the run ends at: a pair of `ref`s naming one def nothing differs in, or the pair one hop on
 * holding no `ref`.
 */
function hopsFrom(first: NodePair, defs: BothDefs): { chain: NodePair[]; tail: Run } {
  const memo = runsOf(defs);
  const chain: NodePair[] = [];
  for (let pair = first; ; ) {
    const kept = memo.get(pair.baseline)?.get(pair.proposed);
    if (kept !== undefined) {
      return { chain, tail: kept };
    }
    chain.push(pair);
    if (isUnchangedRefPair(pair, defs)) {
      return { chain, tail: noLinks };
    }
    const onward = hopPairOf(pair, defs);
    if (holdsNoRef(onward)) {
      return { chain, tail: noLinks };
    }
    pair = onward;
  }
}

/** The def each pair of a chain is placed in, from the proposed `ref` of the pair before it. */
function placesOf(
  chain: readonly NodePair[],
  first: string | undefined,
): readonly (string | undefined)[] {
  const places: (string | undefined)[] = [first];
  for (const [index, pair] of chain.entries()) {
    places.push(refNameOf(pair.proposed) ?? places[index]);
  }
  return places;
}

/**
 * The alias pairs with findings on the hops from a pair whose hop passes an alias def, in the
 * order the walk one hop at a time meets them. The run from each alias pair, its own link first,
 * is kept for the two defs values, so each alias pair's findings are read once for them and a
 * chain that meets a pair another chain met shares its link.
 */
export function aliasLinksOf(start: NodePair, defs: BothDefs): AliasLink | undefined {
  const memo = runsOf(defs);
  const { chain, tail } = hopsFrom(hopPairOf(start, defs), defs);
  const places = placesOf(chain, refNameOf(start.proposed));
  let run = tail;
  for (let index = chain.length - 1; index >= 0; index--) {
    const pair = chain[index] as NodePair;
    const findings = foundIn(pair, defs);
    if (findings.length > 0) {
      run = { links: { pair, def: places[index], findings, next: run.links } };
    }
    const byProposed = memo.get(pair.baseline) ?? new Map<SchemaNode, Run>();
    memo.set(pair.baseline, byProposed);
    byProposed.set(pair.proposed, run);
  }
  return run.links;
}

function foundIn(pair: NodePair, defs: BothDefs): readonly Extract<Finding, { kind: 'found' }>[] {
  return findingsOf(pair, defs, 'hop').filter(
    (finding): finding is Extract<Finding, { kind: 'found' }> => finding.kind === 'found',
  );
}
