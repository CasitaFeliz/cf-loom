import { heldNodeOf, type SchemaNode, type Step } from '../walker/index.ts';
import { isUnchangedRefPair } from './def-comparison.ts';
import type { NodePair } from './findings.ts';
import { placeCopy } from './graft-copy.ts';
import { followedPairOf, graftRecorded, pairMet } from './graft-names.ts';
import { defPut, type Frame, type Place, renamedRef, type Walk } from './graft-walk.ts';
import { findingsOf } from './pair-findings.ts';

/** Applies the next finding of a pair being built: the pair inside it followed, or a field removed grafted back. */
export function stepGraft(walk: Walk, frame: Extract<Frame, { kind: 'graft' }>): void {
  const next = frame.findings.next();
  if (next.done === true) {
    walk.frames.pop();
    frame.put(heldNodeOf(frame.node, frame.edits));
    return;
  }
  const finding = next.value;
  const [step] = finding.steps;
  if (step === undefined) {
    return;
  }
  if (finding.kind === 'inside') {
    const put = (child: SchemaNode) => {
      frame.edits.push({ kind: 'child', step, node: child });
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
    frame.edits.push({ kind: 'field', name: step.name, field: { ...field, schema } });
  };
  placeCopy(walk, field.schema, put);
}

/**
 * A pair as the graft follows it, each `ref` resolved to the def it stands for: built in place
 * when the proposed side is written inline, else a `ref` to its def, held as the Snapshot declares
 * it or named apart, built once. A pair of `ref`s naming one def the def comparison finds nothing
 * differing in is held as the proposed side writes it and not followed, since nothing in it is
 * grafted.
 */
export function placePair(walk: Walk, pair: NodePair, place: Place): void {
  if (isUnchangedRefPair(pair, walk.defs)) {
    place.put(pair.proposed);
    return;
  }
  const followed = followedPairOf(pair, walk.defs);
  if (pair.proposed.type !== 'ref') {
    pushGraft(walk, followed.pair, place);
    return;
  }
  const { index, name, isBuilt } = pairMet(walk.met, followed.key, place.owner);
  const nullable = followed.pair.proposed.nullable === true;
  place.put(name === undefined ? pair.proposed : renamedRef(pair.proposed, { name, nullable }));
  if (isBuilt) {
    pushGraft(walk, followed.pair, { owner: index, put: defPut(walk, name) });
  }
}

function pushGraft(walk: Walk, pair: NodePair, place: Place): void {
  walk.frames.push({
    kind: 'graft',
    former: pair.baseline,
    findings: findingsOf(pair, walk.defs, 'use').values(),
    owner: place.owner,
    node: pair.proposed,
    edits: [],
    put: place.put,
  });
}
