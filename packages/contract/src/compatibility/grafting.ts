import type { FormerInput, InputSnapshot } from '../snapshot/index.ts';
import {
  type Child,
  childrenOf,
  type Defs,
  defsReachedOf,
  refNamed,
  type SchemaNode,
  type Step,
  withChild,
  withField,
  withoutNullable,
} from '../walker/index.ts';
import type { BothDefs, Finding, NodePair } from './findings.ts';
import {
  copyMet,
  followedPairOf,
  followedRefOf,
  type GraftDefs,
  graftRecorded,
  namedDefs,
  pairMet,
  recordingDefs,
} from './graft-names.ts';
import { findingsOf } from './schemas.ts';

/** What a former Input is rewritten onto: an Endpoint's query and body as proposed, and the defs their `ref`s name. */
export type GraftTarget = {
  readonly input: Pick<InputSnapshot, 'query' | 'body'>;
  readonly defs: Defs;
};

type Grafted = Pick<FormerInput, 'input' | 'defs'>;

/**
 * A former Input rewritten onto an Endpoint's query and body: the Endpoint's, with every field the
 * former Input has and they lack grafted in as it was, wherever the Input rules compare fields, and
 * the defs they reach, the Endpoint's under their names and the others named apart; `undefined`
 * when it grafts no field, so the former Input is forgotten.
 */
export function graftedInputOf(former: Grafted, onto: GraftTarget): Grafted | undefined {
  const defs = { baseline: former.defs, proposed: onto.defs };
  const recorded = walked(former, onto.input, { defs, met: recordingDefs() });
  if (!recorded.grafts) {
    return undefined;
  }
  const named = walked(former, onto.input, { defs, met: namedDefs(recorded.met, onto.defs) });
  const nodes = [named.input.query, named.input.body].filter((node) => node !== null);
  return { input: named.input, defs: defsReachedOf(nodes, { ...onto.defs, ...named.out }) };
}

/** Where a node the walk builds goes once it is built. */
type Put = (node: SchemaNode) => void;

/**
 * One node being built on the walk's stack: the proposed node with a pair's findings applied, the
 * former node at hand for the fields it grafts, or a former node copied child by child.
 */
type Frame =
  | {
      readonly kind: 'graft';
      readonly former: SchemaNode;
      readonly findings: Iterator<Finding>;
      readonly owner: number | undefined;
      node: SchemaNode;
      readonly put: Put;
    }
  | {
      readonly kind: 'copy';
      readonly children: Iterator<Child>;
      node: SchemaNode;
      readonly put: Put;
    };

/** A walk of a former Input onto an Endpoint's: recording its def sources, or, once named, building. */
type Walk = {
  readonly defs: BothDefs;
  readonly met: GraftDefs;
  readonly out: Record<string, SchemaNode>;
  readonly frames: Frame[];
  grafts: boolean;
};

type Options = Pick<Walk, 'defs' | 'met'>;

function walked(former: Grafted, onto: GraftTarget['input'], options: Options) {
  const walk: Walk = { ...options, out: {}, frames: [], grafts: false };
  const query = partGrafted(walk, former.input.query, onto.query);
  const body = partGrafted(walk, former.input.body, onto.body);
  if (query?.type !== 'object') {
    throw new Error('A query grafted into no object: a bug.');
  }
  const input = { query, body };
  return { input, out: walk.out, grafts: walk.grafts, met: walk.met };
}

function partGrafted<Part extends SchemaNode | null>(
  walk: Walk,
  former: SchemaNode | null,
  proposed: Part,
): Part | SchemaNode {
  if (former === null || proposed === null) {
    return proposed;
  }
  let built: SchemaNode = proposed;
  const put = (node: SchemaNode) => {
    built = node;
  };
  placePair(walk, { baseline: former, proposed }, { owner: undefined, put });
  runFrames(walk);
  return built;
}

/** Builds every frame on the stack, depth first, each put in its place once its findings are applied. */
function runFrames(walk: Walk): void {
  for (let frame = walk.frames.at(-1); frame !== undefined; frame = walk.frames.at(-1)) {
    if (frame.kind === 'graft') {
      stepGraft(walk, frame);
    } else {
      stepCopy(walk, frame);
    }
  }
}

function stepGraft(walk: Walk, frame: Extract<Frame, { kind: 'graft' }>): void {
  const next = frame.findings.next();
  if (next.done === true) {
    walk.frames.pop();
    frame.put(frame.node);
    return;
  }
  const finding = next.value;
  const [step] = finding.steps;
  if (step === undefined) {
    return;
  }
  if (finding.kind === 'inside') {
    const put = (child: SchemaNode) => {
      frame.node = withChild(frame.node, step, child);
    };
    placePair(walk, finding.pair, { owner: frame.owner, put });
  } else if (finding.shape.kind === 'field-removed') {
    graftField(walk, frame, step);
  }
}

/** A field the former node has and the proposed one lacks, put back with its `required` and its schema copied. */
function graftField(walk: Walk, frame: Extract<Frame, { kind: 'graft' }>, step: Step): void {
  const field =
    step.kind === 'field' && frame.former.type === 'object'
      ? frame.former.fields[step.name]
      : undefined;
  if (field === undefined || step.kind !== 'field') {
    throw new Error('A field removed that the former node does not hold: a bug.');
  }
  walk.grafts = true;
  graftRecorded(walk.met, frame.owner);
  const put = (schema: SchemaNode) => {
    frame.node = withField(frame.node, step.name, { ...field, schema });
  };
  put(field.schema);
  placeCopy(walk, field.schema, put);
}

/** Where a pair's node goes, and the def whose body it sits in, if any. */
type Place = { readonly owner: number | undefined; readonly put: Put };

/**
 * A pair as the graft follows it, each `ref` resolved to the def it stands for: built in place when the proposed side is written inline, else
 * a `ref` to its def, held as the Snapshot declares it or named apart, built once.
 */
function placePair(walk: Walk, pair: NodePair, place: Place): void {
  const followed = followedPairOf(pair, walk.defs);
  if (pair.proposed.type !== 'ref') {
    pushGraft(walk, followed.pair, place);
    return;
  }
  const { index, name, isBuilt } = pairMet(walk.met, followed.key, place.owner);
  const chain = { nullable: followed.pair.proposed.nullable === true };
  place.put(name === undefined ? pair.proposed : refNamed(pair.proposed, name, chain));
  if (isBuilt) {
    pushGraft(walk, followed.pair, { owner: index, put: defPut(walk, name) });
  }
}

/** Where the body of a def named apart goes: the former Input's defs, plain, as every def is; nowhere while recording. */
function defPut(walk: Walk, name: string | undefined): Put {
  return (node) => {
    if (name !== undefined) {
      walk.out[name] = withoutNullable(node);
    }
  };
}

function pushGraft(walk: Walk, pair: NodePair, place: Place): void {
  walk.frames.push({
    kind: 'graft',
    former: pair.baseline,
    findings: findingsOf(pair, walk.defs).values(),
    owner: place.owner,
    node: pair.proposed,
    put: place.put,
  });
}

/** A node only the former Input has, copied as it was, each def it reaches copied and named apart. */
function placeCopy(walk: Walk, node: SchemaNode, put: Put): void {
  if (node.type !== 'ref') {
    walk.frames.push({ kind: 'copy', children: childrenOf(node).values(), node, put });
    return;
  }
  const resolved = followedRefOf(node, walk.defs.baseline);
  const { name, isBuilt } = copyMet(walk.met, resolved.name);
  put(refNamed(node, name ?? resolved.name, resolved));
  if (isBuilt) {
    placeCopy(walk, resolved.def, defPut(walk, name));
  }
}

function stepCopy(walk: Walk, frame: Extract<Frame, { kind: 'copy' }>): void {
  const next = frame.children.next();
  if (next.done === true) {
    walk.frames.pop();
    frame.put(frame.node);
    return;
  }
  const [step] = next.value.steps;
  if (step !== undefined) {
    placeCopy(walk, next.value.node, (child) => {
      frame.node = withChild(frame.node, step, child);
    });
  }
}
