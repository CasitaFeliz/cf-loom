import type { z } from 'zod';
import type { $ZodIssue } from 'zod/v4/core';
import {
  canonicalSnapshotOf,
  type PublishedSnapshot,
  type SnapshotFormat,
  snapshotFormats,
} from '../snapshot/index.ts';
import type { Path } from '../walker/index.ts';
import { ownOf } from '../written/index.ts';
import { type Problem, referenceProblemOf } from './references.ts';
import { publishedSnapshot } from './structure.ts';

/** A `snapshot.json` as decoded: the published Snapshot, or why it cannot be trusted. */
export type DecodedSnapshot =
  | { readonly kind: 'decoded'; readonly snapshot: PublishedSnapshot }
  | { readonly kind: 'no-json'; readonly reason: string }
  | { readonly kind: 'newer-format'; readonly format: number }
  | ({ readonly kind: 'malformed' } & Problem);

/** Each format's structure, which decodes what that format wrote into the model of today. */
const structures: Readonly<Record<SnapshotFormat, z.ZodType<PublishedSnapshot>>> = {
  1: publishedSnapshot,
};

/**
 * A `snapshot.json` from the registry, decoded by the format it names into the published Snapshot
 * in canonical order; anything its format does not define, or a name it uses and does not hold, is
 * refused rather than read as far as it goes.
 */
export function decodeSnapshot(text: string): DecodedSnapshot {
  const parsed = parsedJsonOf(text);
  if (parsed.kind === 'no-json') {
    return parsed;
  }
  const format = formatOf(parsed.json);
  return format.kind === 'known' ? decodedBy(structures[format.format], parsed.json) : format;
}

type Parsed =
  | { readonly kind: 'json'; readonly json: unknown }
  | Extract<DecodedSnapshot, { kind: 'no-json' }>;

function parsedJsonOf(text: string): Parsed {
  try {
    return { kind: 'json', json: JSON.parse(text) };
  } catch (e) {
    return { kind: 'no-json', reason: e instanceof Error ? e.message : String(e) };
  }
}

type Format =
  | { readonly kind: 'known'; readonly format: SnapshotFormat }
  | Extract<DecodedSnapshot, { kind: 'newer-format' | 'malformed' }>;

/** The format a text names: a whole number from 1 is one cf-loom knows, else a newer cf-loom wrote it. */
function formatOf(json: unknown): Format {
  const format = ownOf(json, 'format');
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
    return { kind: 'malformed', at: ['format'], reason: 'is not a whole number from 1' };
  }
  const known = snapshotFormats.find((candidate) => candidate === format);
  return known === undefined ? { kind: 'newer-format', format } : { kind: 'known', format: known };
}

function decodedBy(structure: z.ZodType<PublishedSnapshot>, json: unknown): DecodedSnapshot {
  const structured = structure.safeParse(json);
  if (!structured.success) {
    return { kind: 'malformed', ...problemOf(structured.error.issues) };
  }
  const problem = referenceProblemOf(structured.data);
  if (problem !== undefined) {
    return { kind: 'malformed', ...problem };
  }
  return { kind: 'decoded', snapshot: canonicalSnapshotOf(structured.data) };
}

/** The first of the structure's issues as one place and one reason. */
function problemOf(issues: readonly $ZodIssue[]): Problem {
  const [issue] = issues;
  if (issue === undefined) {
    return { at: [], reason: 'is not a Snapshot its format defines' };
  }
  const at: Path = issue.path.map((step) => (typeof step === 'symbol' ? String(step) : step));
  if (issue.code === 'unrecognized_keys') {
    return { at: [...at, issue.keys[0] ?? ''], reason: 'is a key its format does not define' };
  }
  if (issue.code === 'invalid_union') {
    const reason =
      issue.errors.length === 0
        ? 'is not a value its format defines'
        : 'matches none of the forms its format defines';
    return { at, reason };
  }
  return { at, reason: issue.message };
}
