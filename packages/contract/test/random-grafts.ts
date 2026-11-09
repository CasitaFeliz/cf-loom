import type {
  Defs,
  Field,
  ObjectNode,
  RefNode,
  SchemaNode,
  ServiceSnapshot,
} from '../src/internal/index.ts';
import { anObject, aRef, aString, aVersionOf } from './graft-fixtures.ts';
import { defsReachedUnenteredFrom, edgesOf, type Site, sitesIn } from './graft-sites.ts';
import { defPairOf } from './random-def-pairs.ts';
import type { Next } from './random-draft.ts';
import { droppedDefsOf, removedSchemaOf, useOf } from './random-removed-schemas.ts';
import { seededNext } from './random-schemas.ts';

/**
 * A Service version and the next, which only removes fields: from the Endpoint's Input body, and
 * from objects inside the defs that the graft enters (an object field, array items, a record's
 * value, a tuple's rest, a tagged variant), never inside what it does not (a union's option, a
 * tuple's item, an `allOf`'s item) or a def reached through one.
 */
export type GraftDraw = {
  readonly baseline: ServiceSnapshot;
  readonly proposed: ServiceSnapshot;
  /** What the draw holds: the steps down to an object a field was removed from, and the nodes inside a removed field. */
  readonly kinds: ReadonlySet<string>;
  /** The defs a field was removed from, one name for each removal that took a field out. */
  readonly landed: readonly string[];
};

type Removal = { readonly site: Site; readonly field: string };

type Draftable = { [key: string]: unknown };

/** The field names an object can lose without ceasing to be the variant of a tagged union it may be. */
function removableOf(site: Site): readonly string[] {
  return Object.keys(site.object.fields).filter((name) => name !== 'kind');
}

function removalsIn(defs: Defs, tainted: ReadonlySet<string>, next: Next): readonly Removal[] {
  const owners = Object.keys(defs).filter((name) => !tainted.has(name));
  const sites = owners.flatMap((owner) => sitesIn(owner, defs[owner] as SchemaNode));
  const removable = sites.filter((site) => removableOf(site).length > 0 && next() < 0.5);
  return removable.map((site) => {
    const names = removableOf(site);
    return { site, field: names[Math.floor(next() * names.length)] as string };
  });
}

/** The field a removal takes out of the copy of the defs given, with the schema it held; none when an earlier removal took out the way to it. */
function removed(
  defs: Record<string, Draftable>,
  { site, field }: Removal,
): SchemaNode | undefined {
  let at: unknown = defs[site.owner];
  for (const piece of site.path) {
    at = (at as Draftable | undefined)?.[String(piece)];
  }
  const fields = (at as { fields?: Record<string, Field> } | undefined)?.fields;
  const held = fields?.[field];
  if (fields === undefined || held === undefined) {
    return undefined;
  }
  Reflect.deleteProperty(fields, field);
  return held.schema;
}

/** The kinds a `ref` in a removed field's schema is of: nullable or not, and to an alias or to a def. */
function refKindsOf(ref: RefNode, defs: Defs): readonly string[] {
  const nullable = ref.nullable === true ? 'copy: nullable ref' : 'copy: plain ref';
  const target = defs[ref.name]?.type === 'ref' ? 'copy: ref to an alias' : 'copy: ref to a def';
  return [nullable, target];
}

/** The kinds of node inside a removed field's schema, which the graft copies. */
function copiedKindsOf(schema: SchemaNode, defs: Defs): readonly string[] {
  const kinds: string[] = [];
  const pending = [schema];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    kinds.push(`copy: ${next.type}`);
    if (next.type === 'ref') {
      for (const kind of refKindsOf(next, defs)) {
        kinds.push(kind);
      }
    }
    if (next.type === 'record') {
      kinds.push('copy: record key');
    }
    if (next.type === 'tuple' && next.rest !== undefined) {
      kinds.push('copy: tuple rest');
    }
    for (const edge of edgesOf(next)) {
      pending.push(edge.child);
    }
  }
  return kinds;
}

/** An object of fields `a`, `b` and `c`, the first naming a def, with a discriminator field when it is a variant. */
function objectNamingOf(names: readonly string[], next: Next, tag?: string): ObjectNode {
  const kind: Record<string, Field> =
    tag === undefined
      ? {}
      : { kind: { required: true, schema: { type: 'enum', values: [tag], open: false } } };
  return anObject({
    ...kind,
    a: { required: next() < 0.5, schema: useOf(names, next) },
    b: { required: next() < 0.5, schema: aString },
    c: { required: next() < 0.5, schema: aString },
  });
}

/** Defs holding an object under each step the graft enters, each drawn with some chance. */
function wrapperDefsOf(names: readonly string[], next: Next): Defs {
  const objectOf = (tag?: string) => objectNamingOf(names, next, tag);
  const tupleOf = (): SchemaNode => ({ type: 'tuple', items: [aString], rest: objectOf() });
  const recordOf = (value: SchemaNode): SchemaNode => ({
    type: 'record',
    key: { type: 'string' },
    value,
  });
  const variants = { '"a"': objectOf('a'), '"b"': objectOf('b') };
  const deep: SchemaNode = { type: 'array', items: recordOf(tupleOf()) };
  const wrappers: Readonly<Record<string, SchemaNode>> = {
    wrapsItems: { type: 'array', items: objectOf() },
    wrapsValue: recordOf(objectOf()),
    wrapsRest: tupleOf(),
    wrapsVariant: { type: 'tagged', discriminator: 'kind', variants },
    wrapsDeep: anObject({ inner: { required: true, schema: deep } }),
  };
  return Object.fromEntries(Object.entries(wrappers).filter(() => next() < 0.6));
}

/** The Input body with the fields that stay, and with the ones a version removes besides. */
function bodyOf(
  names: readonly string[],
  dropped: readonly [string, Field][],
  next: Next,
): { kept: ObjectNode; full: ObjectNode } {
  const kept = names.map((name): [string, Field] => [
    `k_${name}`,
    { required: next() < 0.5, schema: useOf([name], next) },
  ]);
  const goneCount = 1 + Math.floor(next() * 3);
  const gone = Array.from({ length: goneCount }, (_, index): [string, Field] => [
    `gone${index}`,
    { required: next() < 0.5, schema: removedSchemaOf(names, next) },
  ]);
  return {
    kept: anObject(Object.fromEntries(kept)),
    full: anObject(Object.fromEntries([...kept, ...gone, ...dropped])),
  };
}

type Applied = { readonly removal: Removal; readonly schema: SchemaNode };

/** The defs without the fields some objects lose, and the removals that took a field out. */
function withRemovals(defs: Defs, kept: ObjectNode, next: Next) {
  const roots = Object.values(kept.fields).map(({ schema }) => schema);
  const removals = removalsIn(defs, defsReachedUnenteredFrom(roots, defs), next);
  const proposedDefs = structuredClone(defs) as Record<string, Draftable>;
  const taken = removals.map((removal) => ({ removal, schema: removed(proposedDefs, removal) }));
  const applied = taken.filter((entry): entry is Applied => entry.schema !== undefined);
  return { proposedDefs: proposedDefs as unknown as Defs, applied };
}

/** The pair of Service versions a seed draws, the same every run, so a failing draw can be replayed. */
export function graftDrawOf(seed: number): GraftDraw {
  const next = seededNext(seed * 7919 + 11);
  const graph = defPairOf(seed).baseline;
  const defs: Defs = { ...graph, ...wrapperDefsOf(Object.keys(graph), next) };
  const dropped = droppedDefsOf(Object.keys(defs), next);
  const { kept, full } = bodyOf(Object.keys(defs), dropped.fields, next);
  const { proposedDefs, applied } = withRemovals(defs, kept, next);
  const baselineDefs: Defs = { ...defs, ...dropped.defs };
  const gone = Object.entries(full.fields)
    .filter(([name]) => name.startsWith('gone') || name.startsWith('dropped_'))
    .map(([, field]) => field.schema);
  const graftSteps = applied.flatMap(({ removal }) => removal.site.steps.map((s) => `graft: ${s}`));
  const copied = [...gone, ...applied.map(({ schema }) => schema)];
  const droppedKinds = Object.keys(dropped.defs).map((name) => `dropped: ${name}`);
  const kinds = new Set([
    ...graftSteps,
    ...droppedKinds,
    ...copied.flatMap((schema) => copiedKindsOf(schema, baselineDefs)),
  ]);
  return {
    baseline: aVersionOf(full, baselineDefs),
    proposed: aVersionOf(kept, proposedDefs),
    kinds,
    landed: applied.map(({ removal }) => removal.site.owner),
  };
}

/**
 * Three versions of a Service whose defs are the two graphs of a seeded pair, the first and the
 * rest, the first also holding some defs the rest drop: the Endpoint's body names every def of its
 * version in a field, and in the first version holds three fields besides, which name defs through
 * every kind of node the graft copies and which the next versions remove one at a time.
 */
export function removalHistoryOf(seed: number): readonly ServiceSnapshot[] {
  const next = seededNext(seed * 6007 + 5);
  const pair = defPairOf(seed);
  const names = Object.keys(pair.baseline);
  const removedFields = Array.from({ length: 3 }, (_, index): [string, Field] => [
    `gone${index}`,
    { required: next() < 0.5, schema: removedSchemaOf(names, next) },
  ]);
  const dropped = droppedDefsOf(names, next);
  const keptIn = (defs: Defs) =>
    Object.keys(defs).map((name): [string, Field] => [
      `k_${name}`,
      { required: true, schema: aRef(name) },
    ]);
  const versionWith = (defs: Defs, removedCount: number) => {
    const fields = [...keptIn(defs), ...removedFields.slice(removedCount)];
    return aVersionOf(anObject(Object.fromEntries(fields)), defs);
  };
  return [
    versionWith({ ...pair.baseline, ...dropped.defs }, 0),
    versionWith(pair.proposed, 1),
    versionWith(pair.proposed, 2),
  ];
}
