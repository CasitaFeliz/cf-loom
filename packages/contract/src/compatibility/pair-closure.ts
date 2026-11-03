import type { Defs } from '../walker/index.ts';
import type { BothDefs, NodePair } from './findings.ts';
import { type MetPair, type PairWalk, pairWalkOf, type Walked } from './pair-walk.ts';

/** What is kept for a pair of defs values: the walk every question about them shares, and what it learned of the pairs it met. */
type Kept = {
  readonly walk: PairWalk;
  /** The pair each pair holding a `ref` led to. */
  readonly onward: WeakMap<MetPair, MetPair>;
  /** Whether a removed field is found from a pair, final once the question that met it ends. */
  readonly answers: WeakMap<MetPair, boolean>;
};

const kept = new WeakMap<Defs, WeakMap<Defs, Kept>>();

function keptFor(defs: BothDefs): Kept {
  const byProposed = kept.get(defs.baseline) ?? new WeakMap<Defs, Kept>();
  kept.set(defs.baseline, byProposed);
  const known = byProposed.get(defs.proposed);
  if (known !== undefined) {
    return known;
  }
  const made = { walk: pairWalkOf(defs), onward: new WeakMap(), answers: new WeakMap() };
  byProposed.set(defs.proposed, made);
  return made;
}

/** What a question read of the pairs its walk gave. */
type Read = {
  /** The pairs this question met. */
  readonly met: Set<MetPair>;
  /** For a pair, the pairs whose answer is its answer or follows from it: those that reached it, and those that led to it again. */
  readonly holders: Map<MetPair, MetPair[]>;
  /** The pairs a removed field is found in. */
  readonly seeds: MetPair[];
  /** The pairs that led to a pair entered before, with the pair that entered it. */
  readonly agains: (readonly [MetPair, MetPair])[];
};

function heldBy(read: Read, held: MetPair, holder: MetPair): void {
  const holders = read.holders.get(held) ?? [];
  holders.push(holder);
  read.holders.set(held, holders);
}

function readWalked(walked: readonly Walked[], known: Kept): Read {
  const read: Read = { met: new Set(), holders: new Map(), seeds: [], agains: [] };
  for (const item of walked) {
    if (item.kind === 'found' && item.finding.shape.kind === 'field-removed') {
      read.seeds.push(item.in);
    } else if (item.kind === 'met') {
      read.met.add(item.met);
      const { reached, hop } = item.met;
      if (reached.kind !== 'root') {
        heldBy(read, item.met, reached.by);
      }
      if (reached.kind === 'hop') {
        known.onward.set(reached.by, item.met);
      }
      if (hop?.kind === 'again') {
        read.agains.push([item.met, hop.first]);
      }
    }
  }
  return read;
}

/** A pair that led to a pair entered before holds the answer of the pair that entered it led to, from this question or an earlier one. */
function readAgains(read: Read, known: Kept): void {
  for (const [again, first] of read.agains) {
    const target = known.onward.get(first);
    if (target !== undefined && read.met.has(target)) {
      heldBy(read, target, again);
    } else if (target !== undefined && known.answers.get(target) === true) {
      read.seeds.push(again);
    }
  }
}

/** The pairs a removed field is found from: the seeds, and every pair that holds one of them, however far up. */
function pairsFinding(read: Read): ReadonlySet<MetPair> {
  const finding = new Set<MetPair>();
  const pending = [...read.seeds];
  for (let met = pending.pop(); met !== undefined; met = pending.pop()) {
    if (!finding.has(met)) {
      finding.add(met);
      for (const holder of read.holders.get(met) ?? []) {
        pending.push(holder);
      }
    }
  }
  return finding;
}

/**
 * Whether a pair walk from the root gives a `found` finding of a removed field: read from one walk
 * kept for the two defs values, whose memo every question about them shares, each pair it meets
 * answered once, from its own findings and the answers of the pairs it leads to, and kept as final
 * once the question that met it ends.
 */
export function walkFindsRemovedField(root: NodePair, defs: BothDefs): boolean {
  const known = keptFor(defs);
  const walked = known.walk.pairsFrom(root, []);
  const read = readWalked(walked, known);
  readAgains(read, known);
  const finding = pairsFinding(read);
  for (const met of read.met) {
    known.answers.set(met, finding.has(met));
  }
  const first = walked[0];
  return first?.kind === 'met' && finding.has(first.met);
}
