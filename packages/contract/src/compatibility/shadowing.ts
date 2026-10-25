import {
  type EndpointSnapshot,
  isDeclared,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
} from '../snapshot/index.ts';
import { byCodePoint } from '../walker/index.ts';
import { type Matchable, matchedOf, textAcceptanceOf } from '../wire/index.ts';
import { endpointSegmentsOf, type PathSegment } from '../written/index.ts';
import { comparedShapesOf, type Pair } from './pairs.ts';
import type { Difference } from './report.ts';

/** A declared Endpoint as routing reads it: its identity, method and path segments. */
export type EndpointPath = Matchable & { readonly identity: string };

/**
 * The Endpoints each side routes, Retired ones still declared included, and those the Baseline
 * does not declare, which alone can take a URL.
 */
export type EndpointPaths = {
  readonly baseline: readonly EndpointPath[];
  readonly proposed: readonly EndpointPath[];
  readonly added: readonly EndpointPath[];
};

/** A segment text no literal spells, so only a param matches it. */
const unmatchedText = '{}';

/** Both sides' declared Endpoints as routing reads them, segments from each identity. */
export function endpointPathsOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): EndpointPaths {
  const before = Object.entries(baseline.endpoints)
    .filter(([, endpoint]) => isDeclared(endpoint))
    .map(([identity]) => pathOf(identity));
  const after = Object.keys(proposed.endpoints).map((identity) => pathOf(identity));
  const declaredBefore = new Set(before.map(({ identity }) => identity));
  const added = after.filter(({ identity }) => !declaredBefore.has(identity));
  return { baseline: before, proposed: after, added };
}

/**
 * One `shadowed` per Endpoint the Baseline does not declare that now wins a URL this kept Endpoint
 * won; a Retired Endpoint loses nothing, since it answers every request with `RETIRED`.
 */
export function shadowingDifferencesOf(
  pair: Pair<EndpointSnapshot>,
  paths: EndpointPaths,
): readonly Difference[] {
  const compared = comparedShapesOf(pair);
  if (compared === undefined) {
    return [];
  }
  const sides = [compared.baseline, compared.proposed] as const;
  const kept: KeptPath = { ...pathOf(pair.identity), sides };
  const takers = new Set<string>();
  for (const added of paths.added) {
    const taker = takerOf(kept, added, paths);
    if (taker !== undefined) {
      takers.add(taker);
    }
  }
  return [...takers].sort(byCodePoint).map((by) => ({ kind: 'shadowed', by }));
}

/** A kept Endpoint as routing reads it, with its declaration on both sides, whose params read a URL. */
type KeptPath = EndpointPath & {
  readonly sides: readonly [EndpointSnapshot, EndpointSnapshot];
};

/**
 * The Endpoint that wins a URL the kept Endpoint won in the Baseline, among those competing for
 * the URL both it and the added Endpoint match, when the kept Endpoint's params may take it.
 */
function takerOf(kept: KeptPath, added: EndpointPath, paths: EndpointPaths): string | undefined {
  const texts = overlapOf(kept, added);
  if (
    texts === undefined ||
    !kept.sides.some((side) => mayTake(side, kept, texts)) ||
    matchedOf(paths.baseline, kept.method, texts)?.identity !== kept.identity
  ) {
    return undefined;
  }
  const winner = matchedOf(paths.proposed, kept.method, texts)?.identity;
  return winner === kept.identity ? undefined : winner;
}

/**
 * The segment texts of a URL two Endpoints both match, a literal where either has one and
 * `unmatchedText` where both have a param, or `undefined` when they share no URL.
 */
function overlapOf(kept: EndpointPath, added: EndpointPath): readonly string[] | undefined {
  if (kept.method !== added.method || kept.segments.length !== added.segments.length) {
    return undefined;
  }
  const texts: string[] = [];
  for (const [index, segment] of kept.segments.entries()) {
    const text = textAt(segment, added.segments[index]);
    if (text === undefined) {
      return undefined;
    }
    texts.push(text);
  }
  return texts;
}

/**
 * Whether one side's declaration of the kept Endpoint may take a URL: no param refuses the text it
 * reads there; a text no literal spells stands for any text, so it is not judged.
 */
function mayTake(side: EndpointSnapshot, kept: EndpointPath, texts: readonly string[]): boolean {
  const paramTexts = texts.filter((_text, index) => kept.segments[index]?.kind === 'param');
  return paramTexts.every(
    (text, index) => text === unmatchedText || paramMayTake(side, index, text),
  );
}

/** Whether the param at a position may take a text, by its schema; one with none takes any. */
function paramMayTake(side: EndpointSnapshot, index: number, text: string): boolean {
  const fields = side.input.params?.fields ?? {};
  const name = side.params[index];
  const field = name !== undefined && Object.hasOwn(fields, name) ? fields[name] : undefined;
  return field === undefined || textAcceptanceOf(field.schema, text) !== 'refused';
}

function textAt(kept: PathSegment, added: PathSegment | undefined): string | undefined {
  if (kept.kind === 'literal') {
    return added?.kind === 'literal' && added.text !== kept.text ? undefined : kept.text;
  }
  return added?.kind === 'literal' ? added.text : unmatchedText;
}

function pathOf(identity: string): EndpointPath {
  return { identity, ...endpointSegmentsOf(identity) };
}
