import {
  byCodePoint,
  isUnnamedCycle,
  type Memo,
  movedFrom,
  type NotAllowed,
  type Place,
  siteTextOf,
  stepListOf,
} from '../walker/index.ts';
import type { NotAllowedFailure } from './failures.ts';
import {
  byLocation,
  locationTextOf,
  type MemoPlace,
  memoPlacesOf,
  type Sites,
} from './memo-places.ts';

/**
 * A refusal told where the author reads it, and every site that reaches it; `foldedBy` is what
 * its tellings fold across: the schema refused, or for a cycle no id names the refusal alone.
 */
type Told = {
  readonly refusal: NotAllowed;
  readonly at: Place;
  readonly sites: Sites;
  readonly foldedBy: unknown;
};

/**
 * What the walk refused, as one line for each construct at each location: a refusal inside a
 * remembered schema is told from the first place that schema is reached, with every site that
 * reaches it; a schema several places reach is told once, at the first of them in code point
 * order, with the other sites.
 */
export function notAllowedFailuresOf(
  refusals: readonly NotAllowed[],
  memoOf: ReadonlyMap<NotAllowed, Memo>,
): readonly NotAllowedFailure[] {
  const places = memoPlacesOf(memoOf.values());
  const told = [...new Set(refusals)].map((refusal) =>
    toldOf(refusal, memoOf.get(refusal), places),
  );
  const bySchema = groupedBy(
    told,
    ({ foldedBy }) => foldedBy,
    ({ refusal }) => refusal.construct,
  );
  const firsts = bySchema.map(firstOfGroup);
  const byLine = groupedBy(
    firsts,
    ({ at }) => locationTextOf(at),
    ({ refusal }) => refusal.construct,
  );
  return byLine.map(firstOfGroup).map(failureOf);
}

/**
 * A refusal told at its place, or, raised inside a remembered schema, from that schema's first
 * place; a cycle no id names is told where the walk that refused it met it.
 */
function toldOf(
  refusal: NotAllowed,
  memo: Memo | undefined,
  places: ReadonlyMap<Memo, MemoPlace>,
): Told {
  const own = new Map([[siteTextOf(refusal.site), refusal.site]]);
  if (isUnnamedCycle(refusal)) {
    return { refusal, at: refusal, sites: own, foldedBy: refusal };
  }
  const foldedBy = refusal.schema;
  if (memo === undefined) {
    return { refusal, at: refusal, sites: own, foldedBy };
  }
  const placed = places.get(memo);
  if (placed === undefined) {
    throw new Error('A remembered schema is reached from no place: a bug.');
  }
  return { refusal, at: movedFrom(refusal, memo.at, placed.at), sites: placed.sites, foldedBy };
}

/** The items grouped by two keys, the groups in the order each was first met. */
function groupedBy<Item, Outer>(
  items: readonly Item[],
  outerOf: (item: Item) => Outer,
  innerOf: (item: Item) => string,
): readonly (readonly Item[])[] {
  const byOuter = new Map<Outer, Map<string, Item[]>>();
  const groups: Item[][] = [];
  for (const item of items) {
    const byInner = byOuter.get(outerOf(item)) ?? new Map<string, Item[]>();
    byOuter.set(outerOf(item), byInner);
    const same = byInner.get(innerOf(item));
    if (same === undefined) {
      const group = [item];
      byInner.set(innerOf(item), group);
      groups.push(group);
    } else {
      same.push(item);
    }
  }
  return groups;
}

/** One telling for a group: at the first location in code point order, with every site of the group once. */
function firstOfGroup(group: readonly Told[]): Told {
  const [first, ...others] = [...group].sort((left, right) => byLocation(left.at, right.at));
  if (first === undefined) {
    throw new Error('A construct that is not allowed is reached from at least one place: a bug.');
  }
  const sites = new Map(first.sites);
  for (const told of others) {
    for (const [text, site] of told.sites) {
      sites.set(text, site);
    }
  }
  return { ...first, sites };
}

function failureOf({ refusal, at, sites }: Told): NotAllowedFailure {
  const { construct, instead, origin } = refusal;
  return {
    kind: 'not-allowed',
    site: at.site,
    steps: stepListOf(at.steps),
    construct,
    ...(instead !== undefined && { instead }),
    declaration: at.declaration,
    alsoIn: [...sites]
      .filter(([text]) => text !== siteTextOf(at.site))
      .sort(([left], [right]) => byCodePoint(left, right))
      .map(([, site]) => site),
    origin,
  };
}
