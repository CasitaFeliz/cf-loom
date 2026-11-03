import { unbrokenLineOf } from '../lines/index.ts';
import { type Defs, defGraphOf, refNameOf, type SchemaNode } from '../walker/index.ts';
import { isUnchangedRefPair } from './def-comparison.ts';
import type { BothDefs, Finding, NodePair } from './findings.ts';
import { findingsOf } from './pair-findings.ts';

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
export function hopPairOf(pair: NodePair, defs: BothDefs): NodePair {
  return {
    baseline: defOf(pair.baseline, defs.baseline),
    proposed: defOf(pair.proposed, defs.proposed),
  };
}

/** The def a `ref` names, or the node itself when it is written inline: a name with no def is a bug. */
export function defOf(node: SchemaNode, defs: Defs): SchemaNode {
  if (node.type !== 'ref') {
    return node;
  }
  const def = defGraphOf(defs).def(node.name);
  if (def === undefined) {
    throw new Error(unbrokenLineOf(`\`ref\` to ${node.name} reaches no schema: a bug.`));
  }
  return def;
}

/** Whether a hop from the pair passes over an alias def on either side. */
export function passesAlias(pair: NodePair, defs: BothDefs): boolean {
  const onward = hopPairOf(pair, defs);
  return onward.baseline.type === 'ref' || onward.proposed.type === 'ref';
}

/** Whether neither side of a pair is a `ref`. */
function holdsNoRef({ baseline, proposed }: NodePair): boolean {
  return baseline.type !== 'ref' && proposed.type !== 'ref';
}

/**
 * The alias pairs on the hops from the first, up to the first kept for the two defs values or the
 * one the run ends at: a pair of `ref`s naming one def nothing differs in, the pair one hop on
 * holding no `ref`, or a pair met before on the run.
 */
function hopsFrom(first: NodePair, defs: BothDefs): { chain: NodePair[]; tail: Run } {
  const memo = runsOf(defs);
  const chain: NodePair[] = [];
  const met = new Map<SchemaNode, Set<SchemaNode>>();
  for (let pair = first; ; ) {
    const kept = memo.get(pair.baseline)?.get(pair.proposed);
    if (kept !== undefined) {
      return { chain, tail: kept };
    }
    if (met.get(pair.baseline)?.has(pair.proposed) === true) {
      return { chain, tail: { links: undefined } };
    }
    met.set(pair.baseline, (met.get(pair.baseline) ?? new Set()).add(pair.proposed));
    chain.push(pair);
    if (isUnchangedRefPair(pair, defs)) {
      return { chain, tail: { links: undefined } };
    }
    const onward = hopPairOf(pair, defs);
    if (holdsNoRef(onward)) {
      return { chain, tail: { links: undefined } };
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
 * The alias pairs with findings on the hops from a pair holding a `ref`, in the order the walk
 * one hop at a time meets them. The run from each alias pair, its own link first, is kept for the
 * two defs values, so each alias pair's findings are read once for them and a chain that meets a
 * pair another chain met shares its link.
 */
export function aliasLinksOf(start: NodePair, defs: BothDefs): AliasLink | undefined {
  const first = isUnchangedRefPair(start, defs) ? undefined : hopPairOf(start, defs);
  if (first === undefined || holdsNoRef(first)) {
    return undefined;
  }
  const memo = runsOf(defs);
  const { chain, tail } = hopsFrom(first, defs);
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
