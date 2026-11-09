import {
  canonicalTextOf,
  decodeSnapshot,
  type Field,
  type FormerInput,
  type PublishedServiceSnapshot,
  publishedSnapshotOf,
  type SchemaNode,
  type ServiceSnapshot,
} from '../src/internal/index.ts';
import { problemWithDefsOf } from './graft-defs.ts';
import { graftedIdentity } from './graft-fixtures.ts';
import { differenceFromInput } from './graft-oracle.ts';
import { isRef, nodesIn } from './random-draft.ts';
import { publishedAt } from './snapshots.ts';

/** Every version published in turn, as 1.0.0, 1.1.0 and so on, each against the one before. */
export function publishedEach(
  versions: readonly ServiceSnapshot[],
): readonly PublishedServiceSnapshot[] {
  const publishes: PublishedServiceSnapshot[] = [];
  for (const [minor, version] of versions.entries()) {
    publishes.push(publishedSnapshotOf(publishes.at(-1), version, publishedAt(`1.${minor}.0`)));
  }
  return publishes;
}

/** The last of the versions, published in turn. */
export function publishedThrough(
  ...versions: readonly ServiceSnapshot[]
): PublishedServiceSnapshot {
  const published = publishedEach(versions).at(-1);
  if (published === undefined) {
    throw new Error('No version to publish: a bug of the test.');
  }
  return published;
}

/**
 * What is wrong with the Former Inputs a draw's publish keeps: one that is not the Input as the
 * Baseline held it, up to the names of its defs, one that holds more or fewer defs than it reaches,
 * and a published Snapshot that does not decode.
 */
export function problemsOfPublished(
  draw: { readonly baseline: ServiceSnapshot },
  published: PublishedServiceSnapshot,
): readonly string[] {
  const input = draw.baseline.endpoints[graftedIdentity]?.input;
  const found = published.formerInputs.flatMap((former) => [
    differenceFromInput(former, {
      input: input as Pick<FormerInput, 'input'>['input'],
      defs: draw.baseline.defs,
    }),
    problemWithDefsOf(former),
  ]);
  const undecoded = decodeSnapshot(canonicalTextOf(published)).kind !== 'decoded';
  return [...found, undecoded ? 'does not decode' : undefined].filter(
    (problem) => problem !== undefined,
  );
}

/** The defs of a Former Input named apart from one name, `x~1`, `x~2`…, for each name with two or more. */
export function apartGroupsOf(former: FormerInput): readonly (readonly string[])[] {
  const byBase = new Map<string, string[]>();
  for (const name of Object.keys(former.defs).filter((held) => held.includes('~'))) {
    const base = name.split('~')[0] as string;
    byBase.set(base, [...(byBase.get(base) ?? []), name]);
  }
  return [...byBase.values()].filter((names) => names.length >= 2);
}

/** The defs named apart that a def of a Former Input names. */
function defsApartNamedBy(former: FormerInput, name: string): readonly string[] {
  const names = nodesIn(former.defs[name])
    .filter(isRef)
    .map((ref) => String(ref.name));
  return names.filter((held) => held.includes('~'));
}

/** Whether two defs named apart from one name both name a def named apart. */
export function hasTwoApartNamingOne(former: FormerInput): boolean {
  return apartGroupsOf(former).some((group) =>
    group.some((name, index) =>
      group.slice(index + 1).some((other) => {
        const named = defsApartNamedBy(former, other);
        return defsApartNamedBy(former, name).some((held) => named.includes(held));
      }),
    ),
  );
}

/** The fields of an object node, none for any other. */
export function fieldsOfDef(node: SchemaNode | undefined): Readonly<Record<string, Field>> {
  return node?.type === 'object' ? node.fields : {};
}

/** Whether a node holds, in place, an object of exactly the fields given. */
export function holdsObjectOf(
  node: SchemaNode | undefined,
  fieldNames: readonly string[],
): boolean {
  const wanted = fieldNames.toSorted().join();
  return nodesIn(node).some(
    (inner) =>
      inner.type === 'object' &&
      Object.keys(inner.fields as object)
        .sort()
        .join() === wanted,
  );
}
