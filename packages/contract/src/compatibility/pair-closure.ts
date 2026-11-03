import type { Defs } from '../walker/index.ts';
import type { BothDefs, NodePair } from './findings.ts';
import { type MetPair, type PairWalk, pairWalkOf, type Walked } from './pair-walk.ts';

const kept = new WeakMap<Defs, WeakMap<Defs, PairWalk>>();

/** The walk every question about two defs values shares. */
function keptWalkFor(defs: BothDefs): PairWalk {
  const byProposed = kept.get(defs.baseline) ?? new WeakMap<Defs, PairWalk>();
  kept.set(defs.baseline, byProposed);
  const known = byProposed.get(defs.proposed);
  if (known !== undefined) {
    return known;
  }
  const made = pairWalkOf(defs);
  byProposed.set(defs.proposed, made);
  return made;
}

/** Whether a removed field is found from a pair a kept walk met, final once the question that met it ends. */
const answers = new WeakMap<MetPair, boolean>();

/** What a question read of the pairs its walk gave. */
type Read = {
  /** The pairs this question met. */
  readonly met: Set<MetPair>;
  /** For a pair, the pairs whose answer is its answer or follows from it: those that reached it, and those that led to it again. */
  readonly holders: Map<MetPair, MetPair[]>;
  /** The pairs a removed field is found in. */
  readonly seeds: MetPair[];
  /** The pairs that led to a pair entered before, with that pair. */
  readonly agains: (readonly [MetPair, MetPair])[];
};

function heldBy(read: Read, held: MetPair, holder: MetPair): void {
  const holders = read.holders.get(held) ?? [];
  holders.push(holder);
  read.holders.set(held, holders);
}

function readWalked(given: readonly Walked[]): Read {
  const read: Read = { met: new Set(), holders: new Map(), seeds: [], agains: [] };
  for (const walked of given) {
    if (walked.kind === 'found' && walked.finding.shape.kind === 'field-removed') {
      read.seeds.push(walked.in);
    } else if (walked.kind === 'met') {
      read.met.add(walked.met);
      const { reached, hop } = walked.met;
      if (reached.kind !== 'root') {
        heldBy(read, walked.met, reached.by);
      }
      if (hop?.kind === 'again') {
        read.agains.push([walked.met, hop.entered]);
      }
    }
  }
  return read;
}

/** A pair that led to a pair entered before holds that pair's answer, from this question or an earlier one. */
function readAgains(read: Read): void {
  for (const [again, target] of read.agains) {
    if (read.met.has(target)) {
      heldBy(read, target, again);
    } else if (answers.get(target) === true) {
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
 * The pairs among those a walk gave from which it gives a `found` finding of a removed field: the pairs it is found in, and every pair that holds one of them, by a pair inside it, a
 * `ref` that leads to it, or a `ref` that leads again to a pair it led to.
 */
export function pairsFindingRemovedField(given: readonly Walked[]): ReadonlySet<MetPair> {
  const read = readWalked(given);
  readAgains(read);
  return pairsFinding(read);
}

/**
 * Whether a pair walk from the root gives a `found` finding of a removed field: read from one walk
 * kept for the two defs values, whose memo every question about them shares, each pair it meets
 * answered once, from its own findings and the answers of the pairs it leads to, and kept as final
 * once the question that met it ends.
 */
export function walkFindsRemovedField(root: NodePair, defs: BothDefs): boolean {
  const given = keptWalkFor(defs).pairsFrom(root, []);
  const finding = pairsFindingRemovedField(given);
  for (const walked of given) {
    if (walked.kind === 'met') {
      answers.set(walked.met, finding.has(walked.met));
    }
  }
  const first = given[0];
  return first?.kind === 'met' && finding.has(first.met);
}
