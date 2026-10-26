import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { seededNext } from '../../test/random-schemas.ts';
import {
  compatibilityReportOf,
  decodeSnapshot,
  hashedTextOf,
  type Path,
  type PublishedSnapshot,
  publishedSnapshotOf,
  type Snapshot,
} from '../internal/index.ts';

const examples = ['org-definitions', 'orders-service', 'billing-service'] as const;
const examplesDirectory = new URL('../../../../examples/', import.meta.url);

type Json = unknown;

/** One change to one place of a Snapshot's JSON: a leaf edited, an array or a map reshaped. */
type Mutation = {
  readonly at: Path;
  readonly operation: string;
  readonly change: (snapshot: Json) => Json;
};

function declaredSnapshotOf(example: string): Json {
  const file = new URL(`${example}/contract.snapshot.json`, examplesDirectory);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function valueAt(json: Json, at: Path): Json {
  let value = json;
  for (const key of at) {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    value = Reflect.get(value, key);
  }
  return value;
}

/** A copy of a JSON value with the value at a place replaced by what `change` makes of it, or as it is when the place is gone. */
function changedAt(json: Json, at: Path, change: (value: Json) => Json): Json {
  const copy: Json = structuredClone(json);
  const holder = valueAt(copy, at.slice(0, -1));
  const key = at[at.length - 1] as string | number;
  if (typeof holder !== 'object' || holder === null || !Reflect.has(holder, key)) {
    return copy;
  }
  Reflect.set(holder, key, change(Reflect.get(holder, key)));
  return copy;
}

function placesOf(json: Json, at: Path = []): readonly Path[] {
  if (typeof json !== 'object' || json === null) {
    return [at];
  }
  const inside = Object.entries(json).flatMap(([key, value]) =>
    placesOf(value, [...at, Array.isArray(json) ? Number(key) : key]),
  );
  return [at, ...inside];
}

function mutationsAt(json: Json, at: Path): readonly Mutation[] {
  const value = valueAt(json, at);
  const edit = (operation: string, apply: (value: Json) => Json): Mutation => ({
    at,
    operation,
    change: (snapshot) => changedAt(snapshot, at, apply),
  });
  if (typeof value === 'string') {
    return [edit('append', (text) => `${text as string}x`)];
  }
  if (typeof value === 'number') {
    return [edit('increment', (number) => (number as number) + 1)];
  }
  if (typeof value === 'boolean') {
    return [edit('flip', (flag) => !flag)];
  }
  if (value === null) {
    return [edit('give a value', () => 'x')];
  }
  return Array.isArray(value) ? arrayMutations(value, edit) : mapMutations(value as object, edit);
}

function arrayMutations(
  items: readonly Json[],
  edit: (operation: string, apply: (value: Json) => Json) => Mutation,
): readonly Mutation[] {
  const list = (value: Json) => value as Json[];
  const mutations: Mutation[] = [];
  if (items.length > 1) {
    mutations.push(edit('reorder', (value) => [...list(value)].reverse()));
  }
  if (items.length > 0) {
    mutations.push(edit('shorten', (value) => list(value).slice(0, -1)));
    mutations.push(
      edit('extend', (value) => [...list(value), structuredClone(list(value).at(-1))]),
    );
  }
  return mutations;
}

function mapMutations(
  map: object,
  edit: (operation: string, apply: (value: Json) => Json) => Mutation,
): readonly Mutation[] {
  const keys = Object.keys(map);
  if (keys.length === 0) {
    return [];
  }
  const record = (value: Json) => value as Record<string, Json>;
  const removeLast = (value: Json) => {
    const { [keys.at(-1) as string]: _removed, ...kept } = record(value);
    return kept;
  };
  const addCopy = (value: Json) => ({
    ...record(value),
    added: structuredClone(record(value)[keys[0] as string]),
  });
  return [edit('remove an entry', removeLast), edit('add an entry', addCopy)];
}

/** The keys every Snapshot starts with, which identify the package and the format, not its Contract. */
const headingKeys = ['format', 'kind', 'name', 'generator'];

/**
 * Whether `generate` never writes a place changed alone: the heading, what it derives from other
 * places (the codes' `removed` flags and the codes nothing answers, the Input of a path param and
 * its `params`) and the Guards no Endpoint attaches.
 */
function isUnwritableAlone(kind: string, at: Path): boolean {
  const [section, , part, next] = at;
  if (at.length === 1 && headingKeys.includes(String(section))) {
    return true;
  }
  if (section === 'codes') {
    return at.length === 1 || part === 'removed';
  }
  if (section === 'endpoints') {
    return part === 'params' || (part === 'input' && next === 'params');
  }
  return section === 'guards' && kind === 'service' && at.length === 1;
}

/** A Snapshot with every use of a code under another name, as when a Standard Rejection resolves to it. */
function withCodeRenamed(json: Json, from: string, to: string): Json {
  if (json === from) {
    return to;
  }
  if (Array.isArray(json)) {
    return json.map((item) => withCodeRenamed(item, from, to));
  }
  if (typeof json !== 'object' || json === null) {
    return json;
  }
  const renamed = Object.entries(json).map(([key, value]) => [
    key === from ? to : key,
    withCodeRenamed(value, from, to),
  ]);
  return Object.fromEntries(renamed);
}

/** Each Standard Rejection resolving to another code, which no single place of the Snapshot can change alone. */
function remapsOf(declared: Json): readonly Mutation[] {
  const standard = Reflect.get(declared as object, 'standardRejections') as Record<string, string>;
  return Object.entries(standard).map(([name, code]) => ({
    at: ['standardRejections', name],
    operation: 'resolve to another code',
    change: (snapshot) => withCodeRenamed(snapshot, code, `${code}_REMAPPED`),
  }));
}

function mutationsOf(declared: Json): readonly Mutation[] {
  const kind = String(Reflect.get(declared as object, 'kind'));
  const places = placesOf(declared)
    .filter((at) => at.length > 0 && !isUnwritableAlone(kind, at))
    .flatMap((at) => mutationsAt(declared, at));
  return kind === 'application' ? places : [...places, ...remapsOf(declared)];
}

/** The mutation as a declared Snapshot `generate` can write, or `undefined` when the decoder refuses it. */
function writableAfter(declared: Json, mutations: readonly Mutation[]): Snapshot | undefined {
  let mutated: Json = declared;
  for (const mutation of mutations) {
    mutated = mutation.change(mutated);
  }
  const published = JSON.stringify({ ...(mutated as object), version: '1.0.1' });
  return decodeSnapshot(published).kind === 'decoded' ? (mutated as Snapshot) : undefined;
}

/** Whether publishing the proposed Snapshot over the Baseline writes other text than the Baseline's. */
function differs(baseline: PublishedSnapshot, proposed: Snapshot): boolean {
  const merged = publishedSnapshotOf(baseline, proposed, baseline.version);
  return hashedTextOf(merged) !== hashedTextOf(baseline);
}

function describeMutations(mutations: readonly Mutation[]): string {
  return mutations.map(({ at, operation }) => `${operation} at ${at.join('.')}`).join('; ');
}

describe('compatibilityReportOf, every difference in the published text is a Change', () => {
  test.each(examples)('every single-place mutation of %s that generate can write', (example) => {
    const declared = declaredSnapshotOf(example);
    const baseline = publishedSnapshotOf(undefined, declared as Snapshot, '1.0.0');
    const missed: string[] = [];
    let checked = 0;

    for (const mutation of mutationsOf(declared)) {
      const proposed = writableAfter(declared, [mutation]);
      if (proposed === undefined) {
        continue;
      }
      checked++;
      const report = compatibilityReportOf(baseline, proposed);
      if (differs(baseline, proposed) && report.changes.length === 0) {
        missed.push(describeMutations([mutation]));
      }
    }

    expect(missed).toEqual([]);
    expect(checked).toBeGreaterThan(25);
  });

  test.each(examples)(
    'seeded mutations of several places of %s that generate can write',
    (example) => {
      const declared = declaredSnapshotOf(example);
      const baseline = publishedSnapshotOf(undefined, declared as Snapshot, '1.0.0');
      const candidates = mutationsOf(declared);
      const next = seededNext(165);
      const missed: string[] = [];

      for (let round = 0; round < 300; round++) {
        const count = 2 + Math.floor(next() * 3);
        const chosen = Array.from(
          { length: count },
          () => candidates[Math.floor(next() * candidates.length)] as Mutation,
        );
        const proposed = writableAfter(declared, chosen);
        if (proposed === undefined) {
          continue;
        }
        const report = compatibilityReportOf(baseline, proposed);
        if (differs(baseline, proposed) && report.changes.length === 0) {
          missed.push(describeMutations(chosen));
        }
      }

      expect(missed).toEqual([]);
    },
  );
});
