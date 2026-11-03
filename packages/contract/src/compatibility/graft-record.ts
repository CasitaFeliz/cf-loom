import type { Field, Step } from '../walker/index.ts';
import type { BothDefs, NodePair } from './findings.ts';
import { type CopyRecord, copyRecordOf, type DefSources } from './graft-copy.ts';
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
  /** The record of the pair the hop leads to, for a pair holding a `ref` that is followed or leads to a pair entered before. */
  next: PairRecord | undefined;
  /** Where the def source it is sits among the sources, when it is the pair a proposed `ref` leads to. */
  source: number | undefined;
};

/** The pair of a former node and a proposed def that a proposed `ref` leads to; `base` is the name of the proposed def. */
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
  /** What the walk gave for the query, then for the body. */
  readonly walked: readonly Walked[];
  /** The records into which a field is grafted back. */
  readonly grafting: readonly PairRecord[];
};

type Reading = {
  readonly defs: BothDefs;
  readonly records: Map<MetPair, PairRecord>;
  readonly sources: DefSources<PairSource>;
  readonly walked: Walked[];
  readonly grafting: PairRecord[];
};

/** A Former Input's query and body as one pair walk meets them, each pair once, with the defs it names in the order met. */
export function graftRecordOf(roots: GraftRoots, defs: BothDefs): GraftRecord {
  const walk = pairWalkOf(defs);
  const reading: Reading = {
    defs,
    records: new Map(),
    sources: { all: [], copied: new Map() },
    walked: [],
    grafting: [],
  };
  const query = partRecorded(reading, walk, roots.query);
  const body = roots.body === undefined ? undefined : partRecorded(reading, walk, roots.body);
  const { sources, walked, grafting } = reading;
  return { query, body, sources, walked, grafting };
}

function partRecorded(reading: Reading, walk: PairWalk, root: NodePair): PairRecord {
  const walked = walk.pairsFrom(root, []);
  for (const item of walked) {
    reading.walked.push(item);
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
    next: undefined,
    source: undefined,
  };
  reading.records.set(met, record);
  if (parent !== undefined) {
    linkedUnder(parent, record, reached);
  }
  if (met.hop === undefined) {
    registeredAsSource(reading, record);
  } else if (met.hop.kind === 'again') {
    const next = recordOf(reading, met.hop.entered);
    record.next = next;
  }
}

/** The pair a proposed `ref` leads to is a def the graft meets, once, where the first pair holding a `ref` to it meets it. */
function registeredAsSource(reading: Reading, record: PairRecord): void {
  const { reached } = record.met;
  const proposed = reached.kind === 'hop' ? reached.by.hop?.resolved.proposed : undefined;
  if (proposed !== undefined) {
    record.source = reading.sources.all.length;
    reading.sources.all.push({ kind: 'pair', base: proposed.name, end: record });
  }
}

/** A pair joins the pair it is inside as an edit at its step, or the pair holding the `ref` that led to it as its next. */
function linkedUnder(parent: PairRecord, record: PairRecord, reached: Reached): void {
  switch (reached.kind) {
    case 'root':
      return;
    case 'hop':
      parent.next = record;
      return;
    case 'inside': {
      const [step] = reached.steps;
      if (step !== undefined) {
        parent.edits.push({ kind: 'child', step, record });
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
