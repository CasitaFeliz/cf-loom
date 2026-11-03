import type { Field, ObjectNode, SchemaNode, ServiceSnapshot } from '../src/internal/index.ts';
import {
  annotations,
  areRefsToSameDef,
  type Both,
  hasAliasFinding,
  isClosureSame,
  nameOf,
  resolvedNameOf,
} from './alias-graph-facts.ts';
import { textOf } from './graft-defs.ts';
import type { AliasGraphDraw } from './random-alias-graphs.ts';

/** What a draw holds that a row asserts it draws. */
export type AliasGraphStats = {
  /** A chain met an alias pair another chain had already entered, part way along it. */
  joined: boolean;
  /** An alias pair had a finding of its own. */
  aliasFinding: boolean;
  /** A `ref` to an alias def met `o` written in place. */
  writtenAgainstAlias: boolean;
  /** Two `ref`s resolved to one `o` nothing differs in, with a finding on an alias pair on the way. */
  unchangedBehindAliasFinding: boolean;
};

/** Where a pair is: the def whose steps these are, none at the Endpoint's body, and the steps. */
type Place = { readonly def: string | undefined; readonly steps: readonly string[] };

type Found = { readonly shape: string; readonly place: string };

/** A walk one hop at a time: the defs, what it found, the pairs one hop on it entered, and what the draw holds. */
type Walk = {
  readonly defs: Both;
  readonly found: Found[];
  readonly entered: Map<SchemaNode, Set<SchemaNode>>;
  readonly stats: AliasGraphStats;
};

function emit(walk: Walk, shape: string, place: Place): void {
  const path =
    place.def === undefined
      ? ['input', 'body', ...place.steps]
      : ['defs', place.def, ...place.steps];
  walk.found.push({ shape, place: path.join('.') });
}

/** A pair's own findings: its annotations, the def name it carries, and, for a use, its nullability. Whether it had one. */
function ownFindings(walk: Walk, pair: Pair, place: Place): boolean {
  const before = walk.found.length;
  const { baseline, proposed } = pair.nodes;
  for (const name of annotations) {
    if (textOf(baseline[name]) !== textOf(proposed[name])) {
      emit(walk, `annotation-changed(${name})`, place);
    }
  }
  if (nameOf(baseline) !== nameOf(proposed)) {
    emit(walk, 'annotation-changed(id)', place);
  }
  if (pair.isUse && (baseline.nullable === true) !== (proposed.nullable === true)) {
    emit(walk, proposed.nullable === true ? 'nullability-added' : 'nullability-removed', place);
  }
  return walk.found.length > before;
}

/** Two nodes to compare, how many alias pairs a hop has passed on the way to them, and whether they are a use. */
type Pair = {
  readonly nodes: { readonly baseline: SchemaNode; readonly proposed: SchemaNode };
  readonly isUse: boolean;
  readonly depth: number;
};

function compare(walk: Walk, pair: Pair, place: Place): void {
  const hasOwn = ownFindings(walk, pair, place);
  const { baseline, proposed } = pair.nodes;
  if (baseline.type === 'ref' || proposed.type === 'ref') {
    walk.stats.aliasFinding ||= hasOwn && !pair.isUse;
    hop(walk, pair, place);
  } else if (baseline.type !== proposed.type) {
    emit(walk, `type-changed(${baseline.type}>${proposed.type})`, place);
  } else if (baseline.type === 'object' && proposed.type === 'object') {
    compareFields(walk, { baseline, proposed }, place);
  }
}

function compareFields(
  walk: Walk,
  nodes: { readonly baseline: ObjectNode; readonly proposed: ObjectNode },
  place: Place,
): void {
  const keys = new Set([
    ...Object.keys(nodes.baseline.fields),
    ...Object.keys(nodes.proposed.fields),
  ]);
  for (const key of [...keys].sort()) {
    const inside = { def: place.def, steps: [...place.steps, key] };
    const before = nodes.baseline.fields[key];
    const after = nodes.proposed.fields[key];
    if (before === undefined || after === undefined) {
      emit(
        walk,
        before === undefined ? `field-added(${after?.required})` : 'field-removed',
        inside,
      );
      continue;
    }
    if (before.required !== after.required) {
      emit(walk, after.required ? 'field-made-required' : 'field-made-optional', inside);
    }
    compare(
      walk,
      { nodes: { baseline: before.schema, proposed: after.schema }, isUse: true, depth: 0 },
      inside,
    );
  }
}

function hop(walk: Walk, pair: Pair, place: Place): void {
  const { baseline, proposed } = pair.nodes;
  if (areRefsToSameDef(baseline, proposed, walk.defs)) {
    return;
  }
  const onward = {
    baseline:
      baseline.type === 'ref' ? (walk.defs.baseline[baseline.name] as SchemaNode) : baseline,
    proposed:
      proposed.type === 'ref' ? (walk.defs.proposed[proposed.name] as SchemaNode) : proposed,
  };
  if (walk.entered.get(onward.baseline)?.has(onward.proposed) === true) {
    const isAlias = onward.baseline.type === 'ref' || onward.proposed.type === 'ref';
    walk.stats.joined ||= pair.depth > 0 && isAlias;
    return;
  }
  walk.entered.set(
    onward.baseline,
    (walk.entered.get(onward.baseline) ?? new Set()).add(onward.proposed),
  );
  const restarted = proposed.type === 'ref' ? { def: proposed.name, steps: [] } : place;
  compare(walk, { nodes: onward, isUse: false, depth: pair.depth + 1 }, restarted);
}

/** What a draw holds of the uses of its Endpoint's body: ones a row asserts the draws reach. */
function noteUses(
  walk: Walk,
  bodies: { readonly baseline: ObjectNode; readonly proposed: ObjectNode },
): void {
  for (const [key, { schema: baseline }] of Object.entries(bodies.baseline.fields)) {
    const proposed = (bodies.proposed.fields[key] as Field).schema;
    if (baseline.type !== 'ref') {
      continue;
    }
    if (proposed.type !== 'ref') {
      walk.stats.writtenAgainstAlias ||= walk.defs.baseline[baseline.name]?.type === 'ref';
      continue;
    }
    const resolved = resolvedNameOf(baseline, walk.defs.baseline);
    const isOneDef = resolved === resolvedNameOf(proposed, walk.defs.proposed);
    if (
      isOneDef &&
      isClosureSame(resolved, walk.defs) &&
      hasAliasFinding(baseline, proposed, walk.defs)
    ) {
      walk.stats.unchangedBehindAliasFinding = true;
    }
  }
}

function bodyOf(version: ServiceSnapshot): ObjectNode {
  return version.endpoints['PUT /e']?.input.body as ObjectNode;
}

/**
 * The schema differences between a draw's two versions as lines, in the order the Check reports
 * them, and what the draw holds: a walk of `object`, `string` and `ref` nodes alone, written from
 * COMPATIBILITY.md and sharing no code with the Check. A `ref` is compared where it sits, then
 * the pair it leads to one hop at a time, each pair once, the def of the proposed `ref` restarting
 * the steps; two `ref`s naming one def nothing differs in are not followed; each place and shape
 * is reported once, the first found.
 */
export function oracleOf(draw: AliasGraphDraw): {
  readonly lines: readonly string[];
  readonly stats: AliasGraphStats;
} {
  const stats = {
    joined: false,
    aliasFinding: false,
    writtenAgainstAlias: false,
    unchangedBehindAliasFinding: false,
  };
  const defs = { baseline: draw.baseline.defs, proposed: draw.proposed.defs };
  const walk: Walk = { defs, found: [], entered: new Map(), stats };
  const bodies = { baseline: bodyOf(draw.baseline), proposed: bodyOf(draw.proposed) };
  noteUses(walk, bodies);
  compare(walk, { nodes: bodies, isUse: true, depth: 0 }, { def: undefined, steps: [] });
  const seen = new Set<string>();
  const first = walk.found.filter(
    ({ shape, place }) => !seen.has(`${shape} ${place}`) && seen.add(`${shape} ${place}`),
  );
  return { lines: first.map(({ shape, place }) => `${shape} at ${place}`), stats };
}
