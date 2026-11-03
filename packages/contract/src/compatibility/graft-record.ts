import type { Field, ResolvedRef, Step } from '../walker/index.ts';
import type { BothDefs, NodePair } from './findings.ts';
import { type CopyRecord, copyRecordOf, type DefSources, reachedOrBug } from './graft-copy.ts';
import { type MetPair, type PairWalk, pairWalkOf, type Reached, type Walked } from './pair-walk.ts';

/** What rewriting a pair holds: a pair inside it, at its step, or a field only the former node has, grafted back with its copy. */
export type RecordEdit =
  | { readonly kind: 'child'; readonly step: Step; readonly record: PairRecord }
  | {
      readonly kind: 'field';
      readonly name: string;
      readonly field: Field;
      readonly copy: CopyRecord;
    };

/** A pair the graft met once, with what rewriting it holds and what leads to it. */
export type PairRecord = {
  readonly met: MetPair;
  /** The edits in the order the pair's findings name them. */
  readonly edits: RecordEdit[];
  /** The records that hold this one: the pair it is inside, and each pair holding a `ref` that leads to it. */
  readonly dependents: PairRecord[];
  /** The def the chain of `ref`s this pair is on stands for, from the proposed `ref` that starts it; none when it starts at a proposed side written inline. */
  readonly via: ResolvedRef | undefined;
  /** The record one hop on, for a pair holding a `ref` that is followed or leads to a pair entered before. */
  next: PairRecord | undefined;
  /** The pair holding no `ref` that the chain of hops from this pair ends at: itself for such a pair, none when the chain stops at two `ref`s nothing differs in. */
  end: PairRecord | undefined;
  /** Where the def source it ends sits among the sources, when it is the pair a chain from a proposed `ref` ends at. */
  source: number | undefined;
};

/** A pair of a former node and a proposed def that a chain of `ref`s from a proposed `ref` ends at; `base` is the name of the proposed def. */
export type PairSource = {
  readonly kind: 'pair';
  readonly base: string;
  readonly end: PairRecord;
};

/** The pairs of a Former Input's query and of its body, none for a part the Endpoint or the Former Input lacks. */
export type GraftRoots = { readonly query: NodePair; readonly body: NodePair | undefined };

/** A Former Input's query and body as one pair walk meets them, each pair once, with the defs it names in the order met. */
export type GraftRecord = {
  readonly query: PairRecord;
  readonly body: PairRecord | undefined;
  readonly sources: DefSources<PairSource>;
  /** The records into which a field is grafted back. */
  readonly grafting: readonly PairRecord[];
};

type Reading = {
  readonly defs: BothDefs;
  readonly records: Map<MetPair, PairRecord>;
  readonly sources: DefSources<PairSource>;
  readonly grafting: PairRecord[];
};

/** A Former Input's query and body as one pair walk meets them, each pair once, with the defs it names in the order met. */
export function graftRecordOf(roots: GraftRoots, defs: BothDefs): GraftRecord {
  const walk = pairWalkOf(defs);
  const reading: Reading = {
    defs,
    records: new Map(),
    sources: { all: [], copied: new Map() },
    grafting: [],
  };
  const query = partRecorded(reading, walk, roots.query);
  const body = roots.body === undefined ? undefined : partRecorded(reading, walk, roots.body);
  const { sources, grafting } = reading;
  return { query, body, sources, grafting };
}

function partRecorded(reading: Reading, walk: PairWalk, root: NodePair): PairRecord {
  const walked = walk.pairsFrom(root, []);
  for (const item of walked) {
    if (item.kind === 'met') {
      recordedMet(reading, item.met);
    } else if (item.kind === 'found') {
      recordedFound(reading, item);
    }
  }
  const first = walked[0];
  return recordOf(reading, first?.kind === 'met' ? first.met : undefined);
}

/** The record of a pair the walk met: one it has not given is a bug. */
function recordOf(reading: Reading, met: MetPair | undefined): PairRecord {
  const record = met === undefined ? undefined : reading.records.get(met);
  if (record === undefined) {
    throw new Error('A pair the graft did not record: a bug.');
  }
  return record;
}

function recordedMet(reading: Reading, met: MetPair): void {
  const { reached } = met;
  const parent = reached.kind === 'root' ? undefined : recordOf(reading, reached.by);
  const record: PairRecord = {
    met,
    edits: [],
    dependents: [],
    via: viaOf(met, parent),
    next: undefined,
    end: undefined,
    source: undefined,
  };
  reading.records.set(met, record);
  if (parent !== undefined) {
    linkedUnder(parent, record, reached);
  }
  if (met.hop === undefined) {
    chainEnded(reading, record, record);
    registeredAsSource(reading, record);
  } else if (met.hop.kind === 'again') {
    const next = recordOf(reading, met.hop.first).next;
    record.next = next;
    next?.dependents.push(record);
    chainEnded(reading, record, next?.end);
  }
}

/** A pair at the end of a chain of hops gives the end to every pair holding a `ref` before it, back to the pair that starts the chain. */
function chainEnded(reading: Reading, last: PairRecord, end: PairRecord | undefined): void {
  for (let record = last; ; ) {
    record.end = end;
    const { reached } = record.met;
    if (reached.kind !== 'hop') {
      return;
    }
    record = recordOf(reading, reached.by);
  }
}

/** The pair a chain from a proposed `ref` ends at is a def the graft meets, once, where the chain's first pair meets it. */
function registeredAsSource(reading: Reading, record: PairRecord): void {
  if (record.met.reached.kind === 'hop' && record.via !== undefined) {
    record.source = reading.sources.all.length;
    reading.sources.all.push({ kind: 'pair', base: record.via.name, end: record });
  }
}

/** The def the chain of `ref`s a pair is on stands for: from a proposed `ref` that is followed, else from its parent's chain. */
function viaOf(met: MetPair, parent: PairRecord | undefined): ResolvedRef | undefined {
  if (met.reached.kind === 'hop') {
    return parent?.via;
  }
  const { hop, pair } = met;
  if (hop === undefined || hop.kind === 'unchanged') {
    return undefined;
  }
  if (pair.baseline.type === 'ref') {
    reachedOrBug(pair.baseline, hop.resolved.baseline);
  }
  return pair.proposed.type === 'ref'
    ? reachedOrBug(pair.proposed, hop.resolved.proposed)
    : undefined;
}

/** A pair joins the pair it is inside as an edit at its step, or the pair holding the `ref` that led to it as its next. */
function linkedUnder(parent: PairRecord, record: PairRecord, reached: Reached): void {
  switch (reached.kind) {
    case 'root':
      return;
    case 'hop':
      parent.next = record;
      record.dependents.push(parent);
      return;
    case 'inside': {
      const [step] = reached.steps;
      if (step !== undefined) {
        parent.edits.push({ kind: 'child', step, record });
        record.dependents.push(parent);
      }
      return;
    }
  }
}

/** A field removed is grafted back, recorded with a copy of its schema at once, so the defs it reaches keep the order the body reaches them. */
function recordedFound(
  reading: Reading,
  { in: met, finding }: Extract<Walked, { kind: 'found' }>,
): void {
  const [step] = finding.steps;
  if (finding.shape.kind !== 'field-removed' || step === undefined) {
    return;
  }
  const field =
    step.kind === 'field' && met.pair.baseline.type === 'object'
      ? met.pair.baseline.fields[step.name]
      : undefined;
  if (field === undefined || step.kind !== 'field') {
    throw new Error('A field removed that the former node does not hold: a bug.');
  }
  const record = recordOf(reading, met);
  const copy = copyRecordOf(field.schema, reading.defs.baseline, reading.sources);
  record.edits.push({ kind: 'field', name: step.name, field, copy });
  reading.grafting.push(record);
}
